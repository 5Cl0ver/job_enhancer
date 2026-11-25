"""Apply with Claude: one application, start to finish (spec 022).

The app is the memory and the referee; Claude in Chrome does the work and
Job Catcher is its eyes and hands on the page:

    waiting ─► reading ─► questions ─► writing ─► filling ⇄ needs_you
                                                    │
                     sent ◄─ submitting ◄─ review ─► (fix) ─► filling

- **Claude** calls the connector tools (app/mcp_server.py), which call the
  functions here. Nothing it says is trusted for the end: it can only finish
  a run as sent after the user's OK was recorded (in the app or a chat).
- **The user** answers questions, presses Done keep going, and decides at the
  review, on the application page (phone or computer).
- **Job Catcher** asks ``extension_state`` every couple of seconds while a run
  is open, claims requests (photos, fill), sends their results, and blocks
  Submit buttons on the run's sites until the user's OK.

Every change to a run goes through ``_locked`` (``SELECT … FOR UPDATE`` on
Postgres) so Claude's tools and Job Catcher's results never overwrite each
other's JSON. JSON lists are always replaced, never mutated in place, so
SQLAlchemy sees the change.
"""

import asyncio
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apply import (
    APPLY_ENDED,
    APPLY_FILLING,
    APPLY_NEEDS_YOU,
    APPLY_NOT_SENT,
    APPLY_OPEN,
    APPLY_QUESTIONS,
    APPLY_READING,
    APPLY_REVIEW,
    APPLY_SENT,
    APPLY_STOPPED,
    APPLY_SUBMITTING,
    APPLY_WAITING,
    APPLY_WRITING,
    REQUEST_DONE,
    REQUEST_FAILED,
    REQUEST_FILL,
    REQUEST_PENDING,
    REQUEST_PHOTO,
    REQUEST_WORKING,
    ApplyPhoto,
    ApplyRequest,
    ApplyRun,
    ProfileFact,
)
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import apply_resume, master_profile
from app.services import saved_jobs as sj_svc
from app.services import tracker as tracker_svc
from app.services.match import match_resume

STALE_AFTER = timedelta(hours=3)
PHOTOS_KEPT = timedelta(days=30)
WAIT_SECONDS = 25.0  # how long a tool waits for Job Catcher or the user
POLL_SECONDS = 1.0
MAX_QUESTIONS = 12
MAX_PAGES = 40
MAX_ANSWERS = 120
MAX_EVENTS = 200
MAX_PHOTO_BYTES = 400_000
MAX_PARTS = 8
HELP_KINDS = ("sign_in", "sign_up", "captcha", "question", "site", "other")
DECISIONS = ("submit", "fix", "self")


class RunBusy(Exception):
    """Another run is open; carries its id so the app can link to it."""

    def __init__(self, run_id: uuid.UUID):
        super().__init__("Another application is already going.")
        self.run_id = run_id


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _iso(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.isoformat() if dt else None


def _text(value: Any, limit: int) -> str:
    return re.sub(r"[ \t]+", " ", str(value or "")).strip()[:limit]


def _host(url: str | None) -> str:
    try:
        return (urlsplit(url or "").hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _key(url: str | None) -> str:
    """Host + path: the same page, whatever its query or #fragment."""
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return ""
    return (
        f"{(parts.hostname or '').lower().removeprefix('www.')}{parts.path.rstrip('/')}"
    )


def _event(run: ApplyRun, kind: str, text: str) -> None:
    run.events = [
        *(run.events or []),
        {"at": _iso(_now()), "kind": kind, "text": text[:300]},
    ][-MAX_EVENTS:]
    run.last_activity_at = _now()


def _set(run: ApplyRun, status: str) -> None:
    run.status = status
    run.last_activity_at = _now()


def _add_host(run: ApplyRun, url: str) -> None:
    host = _host(url)
    if host and host not in (run.apply_hosts or []):
        run.apply_hosts = [*(run.apply_hosts or []), host][-20:]


def _apply_url(sj: SavedJob) -> str:
    j = sj.job_listing
    return sj.custom_apply_url or (j.apply_url if j else "") or ""


def _job(sj: SavedJob) -> dict[str, Any]:
    j = sj.job_listing
    return {
        "job_id": str(sj.id),
        "title": sj.custom_title or (j.title if j else ""),
        "company": sj.custom_company or (j.company if j else ""),
        "location": sj.custom_location or (j.location if j else ""),
    }


def _answers(raw: Any, limit: int = MAX_ANSWERS) -> list[dict[str, Any]]:
    """A page's questions and answers, trimmed. Never passwords."""
    out = []
    for item in (raw or [])[:limit]:
        if not isinstance(item, dict):
            continue
        q = _text(item.get("q") or item.get("question"), 300)
        a = _text(item.get("a") or item.get("answer"), 2000)
        if not q or re.search(
            r"password|passcode|\bpin\b|social security|\bssn\b", q, re.I
        ):
            continue
        row: dict[str, Any] = {"q": q, "a": a}
        if item.get("claude"):
            row["claude"] = True
        out.append(row)
    return out


# --------------------------------------------------------------------------- #
# Finding runs
# --------------------------------------------------------------------------- #


async def _expire_stale(db: AsyncSession, user_id: uuid.UUID) -> None:
    cutoff = _now() - STALE_AFTER
    for run in await db.scalars(
        select(ApplyRun).where(
            ApplyRun.user_id == user_id, ApplyRun.status.in_(APPLY_OPEN)
        )
    ):
        if _aware(run.last_activity_at) and _aware(run.last_activity_at) < cutoff:
            _set(run, APPLY_STOPPED)
            run.finished_at = _now()
            run.note = "No activity for 3 hours."
            _event(run, "stopped", "Stopped: no activity for 3 hours.")
    await db.flush()


async def open_run(db: AsyncSession, user_id: uuid.UUID) -> ApplyRun | None:
    await _expire_stale(db, user_id)
    return await db.scalar(
        select(ApplyRun)
        .where(ApplyRun.user_id == user_id, ApplyRun.status.in_(APPLY_OPEN))
        .order_by(ApplyRun.created_at.desc())
        .limit(1)
    )


async def get_run(
    db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID, *, lock: bool = False
) -> ApplyRun:
    q = select(ApplyRun).where(ApplyRun.id == run_id, ApplyRun.user_id == user_id)
    if lock:
        # A fresh read every time: another session (Job Catcher, the app) may
        # have changed it since this session last looked.
        q = q.with_for_update().execution_options(populate_existing=True)
    run = await db.scalar(q)
    if run is None:
        raise LookupError("Application not found")
    return run


async def _locked(db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> ApplyRun:
    run = await get_run(db, user_id, run_id, lock=True)
    if run.status in APPLY_OPEN and _aware(run.last_activity_at) < _now() - STALE_AFTER:
        await _expire_stale(db, user_id)
    return run


async def for_agent(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, *, start: bool = False
) -> ApplyRun:
    """The run Claude means: the one it names, else the open one. Ended runs
    are refused with a plain reason."""
    if run_id:
        try:
            rid = uuid.UUID(str(run_id))
        except ValueError as exc:
            raise ValueError("That run_id isn't a valid id.") from exc
        try:
            run = await _locked(db, user_id, rid)
        except LookupError as exc:
            raise ValueError("No application with that run_id.") from exc
    else:
        found = await open_run(db, user_id)
        if found is None:
            raise ValueError(
                "No application is waiting. Ask the user to press Apply with "
                "Claude on the job in the app first."
            )
        run = await _locked(db, user_id, found.id)
    if run.status in APPLY_ENDED:
        raise ValueError(
            f"This application has ended ({run.status}). Nothing more to do."
        )
    if run.status == APPLY_WAITING and not start:
        raise ValueError("This application hasn't started. Call get_apply_brief first.")
    return run


async def _saved_job(db: AsyncSession, run: ApplyRun) -> SavedJob:
    return await sj_svc.get_saved_job(db, run.saved_job_id, run.user_id)


# --------------------------------------------------------------------------- #
# The app: start, read, answer, decide
# --------------------------------------------------------------------------- #


async def purge_old_photos(db: AsyncSession) -> int:
    """Photos of runs that ended more than 30 days ago (anyone's)."""
    ended = select(ApplyRun.id).where(
        ApplyRun.finished_at.is_not(None), ApplyRun.finished_at < _now() - PHOTOS_KEPT
    )
    res = await db.execute(delete(ApplyPhoto).where(ApplyPhoto.run_id.in_(ended)))
    return res.rowcount or 0


async def create_run(db: AsyncSession, user: User, saved_job_id: uuid.UUID) -> ApplyRun:
    from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION

    sj = await sj_svc.get_saved_job(db, saved_job_id, user.id)
    busy = await open_run(db, user.id)
    if busy is not None:
        raise RunBusy(busy.id)
    await purge_old_photos(db)
    run = ApplyRun(
        user_id=user.id,
        saved_job_id=sj.id,
        status=APPLY_WAITING,
        questions=[],
        pages=[],
        events=[],
        apply_hosts=[],
        playbook_version=APPLY_PLAYBOOK_VERSION,
        last_activity_at=_now(),
    )
    _add_host(run, _apply_url(sj))
    _event(run, "pressed", "You pressed Apply with Claude.")
    db.add(run)
    await db.flush()
    return run


async def stop_run(db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> ApplyRun:
    run = await _locked(db, user_id, run_id)
    if run.status in APPLY_OPEN:
        _set(run, APPLY_STOPPED)
        run.finished_at = _now()
        run.note = run.note or "You stopped it."
        _event(run, "stopped", "You stopped it.")
    await db.flush()
    return run


def _remember(run: ApplyRun, db: AsyncSession, q: dict[str, Any], answer: str) -> None:
    """An answer becomes a thing the user told Claude (updated if re-answered)."""
    fact_id = q.get("fact_id")
    if fact_id:
        q["_update_fact"] = answer
        return
    fact = ProfileFact(
        id=uuid.uuid4(),
        user_id=run.user_id,
        question=q["question"],
        answer=answer,
        saved_job_id=run.saved_job_id,
    )
    db.add(fact)
    q["fact_id"] = str(fact.id)


async def record_answers(
    db: AsyncSession,
    run: ApplyRun,
    answers: list[dict[str, Any]],
    *,
    done: bool,
    source: str,
) -> ApplyRun:
    """Answers from the app or a chat. ``answers`` items: {id | question,
    answer?, skipped?}. Each real answer is kept as a thing told to Claude."""
    questions = [dict(q) for q in (run.questions or [])]
    by_id = {q["id"]: q for q in questions}
    by_text = {q["question"].lower(): q for q in questions}
    n = 0
    for item in answers or []:
        if not isinstance(item, dict):
            continue
        q = by_id.get(str(item.get("id") or "")) or by_text.get(
            _text(item.get("question"), 300).lower()
        )
        if q is None:
            continue
        answer = _text(item.get("answer"), 2000)
        if item.get("skipped") or not answer:
            q.update(skipped=True, answer=None)
        else:
            q.update(
                answer=answer, skipped=False, source=source, answered_at=_iso(_now())
            )
            _remember(run, db, q, answer)
        n += 1
    for q in questions:
        new = q.pop("_update_fact", None)
        if new is not None:
            await db.execute(
                update(ProfileFact)
                .where(
                    ProfileFact.id == uuid.UUID(q["fact_id"]),
                    ProfileFact.user_id == run.user_id,
                )
                .values(answer=new, updated_at=_now())
            )
    run.questions = questions
    if done:
        run.answers_done = True
    where = "the app" if source == "app" else "the chat"
    if n or done:
        _event(
            run,
            "answers",
            f"You answered {n} question{'s' if n != 1 else ''} in {where}"
            + (" and said make the résumé." if done else "."),
        )
    await db.flush()
    return run


async def help_done(
    db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID
) -> ApplyRun:
    run = await _locked(db, user_id, run_id)
    if run.status != APPLY_NEEDS_YOU or not run.help:
        raise ValueError("Claude isn't waiting for you right now.")
    run.help = {**run.help, "done_at": _iso(_now())}
    _event(run, "help_done", "You said keep going.")
    await db.flush()
    return run


async def decide(
    db: AsyncSession,
    run: ApplyRun,
    decision: str,
    note: str | None,
    *,
    by: str,
) -> ApplyRun:
    """The user's call at the review: submit, fix (with a note), or self."""
    if decision not in DECISIONS:
        raise ValueError("decision must be submit, fix or self")
    if run.status != APPLY_REVIEW or not run.review:
        raise ValueError("The application isn't ready for review yet.")
    note = _text(note, 2000) or None
    if decision == "fix" and not note:
        raise ValueError("Say what to fix.")
    run.review = {
        **run.review,
        "decision": decision,
        "note": note,
        "by": by,
        "at": _iso(_now()),
        "read": False,
    }
    where = "in the app" if by == "app" else "in the chat"
    text = {
        "submit": f"You said submit ({where}).",
        "fix": f"You asked for a fix ({where}): {note}",
        "self": "You'll press Submit yourself.",
    }[decision]
    _event(run, "decision", text)
    await db.flush()
    return run


async def mark_sent(
    db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID, how: str
) -> ApplyRun:
    """The user says they pressed the site's Submit (or Job Catcher saw it)."""
    run = await _locked(db, user_id, run_id)
    if run.status not in (APPLY_REVIEW, APPLY_SUBMITTING):
        raise ValueError("This application isn't at the review.")
    if run.status == APPLY_REVIEW and (run.review or {}).get("decision") not in (
        "self",
        "submit",
    ):
        raise ValueError("Press I'll submit it myself first.")
    await _end_sent(db, run, how)
    return run


async def _end_sent(db: AsyncSession, run: ApplyRun, text: str) -> None:
    _set(run, APPLY_SENT)
    run.finished_at = _now()
    _event(run, "sent", text)
    stage = await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == run.user_id, PipelineStage.name == "Applied"
        )
    )
    if stage is not None:
        await tracker_svc.move_job_to_stage(db, run.saved_job_id, stage.id, run.user_id)
    else:
        sj = await db.get(SavedJob, run.saved_job_id)
        if sj and sj.applied_at is None:
            sj.applied_at = _now()
    await db.flush()


# --------------------------------------------------------------------------- #
# What the app shows
# --------------------------------------------------------------------------- #


async def view(db: AsyncSession, run: ApplyRun, *, full: bool = True) -> dict[str, Any]:
    sj = await _saved_job(db, run)
    out: dict[str, Any] = {
        "id": str(run.id),
        "status": run.status,
        "job": _job(sj),
        "apply_url": _apply_url(sj),
        "created_at": _iso(run.created_at),
        "finished_at": _iso(run.finished_at),
        "questions_open": sum(
            1
            for q in run.questions or []
            if not q.get("answer") and not q.get("skipped")
        ),
        "help": run.help,
        "review": _public_review(run.review),
        "note": run.note,
    }
    if not full:
        return out
    photos = {
        str(p.id): (p.page_n, p.part)
        for p in await db.execute(
            select(ApplyPhoto.id, ApplyPhoto.page_n, ApplyPhoto.part).where(
                ApplyPhoto.run_id == run.id
            )
        )
    }
    pages = []
    for page in run.pages or []:
        ids = [pid for pid in page.get("photo_ids", []) if pid in photos]
        pages.append({**page, "photo_ids": ids})
    out.update(
        questions=[
            {
                k: q.get(k)
                for k in ("id", "question", "why", "answer", "skipped", "source")
            }
            for q in run.questions or []
        ],
        answers_done=run.answers_done,
        pages=pages,
        resume_id=str(run.resume_id) if run.resume_id else None,
        document_id=str(run.document_id) if run.document_id else None,
        events=(run.events or [])[-60:],
        started_at=_iso(run.started_at),
    )
    return out


def _public_review(review: dict | None) -> dict | None:
    if not review:
        return None
    return {k: review.get(k) for k in ("round", "decision", "note", "by", "at")}


# --------------------------------------------------------------------------- #
# Claude's side
# --------------------------------------------------------------------------- #


def _missing_skills(description: str, master: str) -> list[str]:
    if not description:
        return []
    return match_resume(master, description).missing[:20]


def _looks_cut(description: str) -> bool:
    d = (description or "").strip()
    return len(d) < 600 or bool(
        re.search(r"(…|\.\.\.)\s*(see |show |read )?more$", d, re.I)
    )


async def brief(db: AsyncSession, user: User, run_id: str | None) -> dict[str, Any]:
    from app.services.apply_playbook import playbook_text

    run = await for_agent(db, user.id, run_id, start=True)
    sj = await _saved_job(db, run)
    if run.status == APPLY_WAITING:
        _set(run, APPLY_READING)
        run.started_at = _now()
        _event(run, "started", "Claude started.")
    else:
        _event(run, "resumed", "Claude picked it up again.")
    profile = await master_profile.profile_text(db, user)
    told = await master_profile.facts(db, user.id)
    told_text = " ".join(f"{f.question} {f.answer}" for f in told)
    description = sj.job_listing.description if sj.job_listing else ""
    await db.flush()
    return {
        "run_id": str(run.id),
        "step": run.status,
        "playbook": playbook_text(),
        "job": {
            **_job(sj),
            "apply_url": _apply_url(sj),
            "description": description,
            "description_looks_cut": _looks_cut(description or ""),
        },
        "master_profile": profile,
        "listing_skills_not_shown": _missing_skills(
            description or "", f"{profile} {told_text}"
        ),
        "questions_so_far": [
            {k: q.get(k) for k in ("id", "question", "answer", "skipped")}
            for q in run.questions or []
        ],
        "resume_ready": bool(run.resume_id),
        "pages_done": len(run.pages or []),
        "review": _public_review(run.review),
        "next": _next(run),
    }


def _next(run: ApplyRun) -> str:
    """What Claude should do from where the run is (also after a new chat)."""
    s = run.status
    if s == APPLY_REVIEW:
        return "Call wait_for_you: the application is waiting for the user's review."
    if s == APPLY_NEEDS_YOU:
        return "Call wait_for_you: you asked the user for help."
    if s == APPLY_SUBMITTING:
        return "The user said submit: press the final Submit, then call finish_apply."
    if run.resume_id:
        return "The résumé is saved. Go on filling the application (playbook step 4)."
    if run.questions and not run.answers_done:
        return "Call wait_for_you for the user's answers to your questions."
    if run.questions:
        return "The user answered. Write the full résumé and call save_resume (step 3)."
    return "Read the job, then ask your questions with ask_questions (step 2)."


async def ask_questions(
    db: AsyncSession, user: User, run_id: str | None, questions: list[dict[str, Any]]
) -> dict[str, Any]:
    run = await for_agent(db, user.id, run_id)
    have = {q["question"].lower() for q in run.questions or []}
    new = []
    for item in questions or []:
        if not isinstance(item, dict):
            continue
        text = _text(item.get("question"), 300)
        if not text or text.lower() in have:
            continue
        have.add(text.lower())
        new.append(
            {
                "id": uuid.uuid4().hex[:10],
                "question": text,
                "why": _text(item.get("why"), 300) or None,
                "answer": None,
                "skipped": False,
            }
        )
    total = len(run.questions or []) + len(new)
    if total > MAX_QUESTIONS:
        raise ValueError(
            f"Ask at most {MAX_QUESTIONS} questions in all; pick the ones that matter."
        )
    if not new and not run.questions:
        raise ValueError(
            "Send at least one question, or call save_resume if none are needed."
        )
    run.questions = [*(run.questions or []), *new]
    run.answers_done = False
    _set(run, APPLY_QUESTIONS)
    _event(
        run,
        "questions",
        f"Claude asked {len(new)} question{'s' if len(new) != 1 else ''}.",
    )
    await db.flush()
    return {
        "run_id": str(run.id),
        "asked": len(new),
        "tell_user": (
            "Tell the user: I have a few questions about things the listing asks "
            "for. Answer them in the Job Enhancer app (phone or computer), or "
            "here in the chat."
        ),
        "next": (
            "Call wait_for_you. If the user answers here in the chat, record "
            "them with user_said."
        ),
    }


async def save_resume(
    db: AsyncSession, user: User, run_id: str | None, content: str
) -> dict[str, Any]:
    run = await for_agent(db, user.id, run_id)
    sj = await _saved_job(db, run)
    _set(run, APPLY_WRITING)
    resume, doc = await apply_resume.save_for_job(db, user, sj, content, run)
    _set(run, APPLY_FILLING)
    _event(run, "resume", f"Claude saved the résumé for this job ({resume.filename}).")
    await db.flush()
    return {
        "run_id": str(run.id),
        "resume_id": str(resume.id),
        "document_id": str(doc.id),
        "file_name": resume.filename,
        "tell_user": (
            "Tell the user: your résumé for this job is saved on the job in the "
            "app. You can view or change it any time."
        ),
        "next": (
            "Open the application (the apply_url from the brief). On each page: "
            "fill_page first, then fill the rest yourself, then page_done before "
            "you press Next."
        ),
    }


async def need_help(
    db: AsyncSession, user: User, run_id: str | None, kind: str, what: str
) -> dict[str, Any]:
    run = await for_agent(db, user.id, run_id)
    if kind not in HELP_KINDS:
        kind = "other"
    what = _text(what, 500)
    if not what:
        raise ValueError("Say what you need the user to do.")
    run.help = {
        "kind": kind,
        "what": what,
        "at": _iso(_now()),
        "done_at": None,
        "from": run.status,
    }
    _set(run, APPLY_NEEDS_YOU)
    _event(run, "help", f"Claude needs you: {what}")
    await db.flush()
    return {
        "run_id": str(run.id),
        "tell_user": (
            f"Tell the user, here in the chat too: {what} Then press Done, keep "
            "going in the app (or tell me here)."
        ),
        "next": "Call wait_for_you until the user says keep going.",
    }


def _new_page(
    run: ApplyRun, url: str, title: str, answers: Any, *, last: bool
) -> dict[str, Any]:
    pages = list(run.pages or [])
    if len(pages) >= MAX_PAGES:
        raise ValueError("That's a lot of pages; ask the user for help with need_help.")
    rnd = (run.review or {}).get("round", 0) + (1 if last else 0) or 1
    page = {
        "n": len(pages) + 1,
        "url": _text(url, 2000),
        "title": _text(title, 120) or f"Page {len(pages) + 1}",
        "answers": _answers(answers),
        "jc_answers": [],
        "photo_ids": [],
        "photo": "waiting",
        "reason": None,
        "at": _iso(_now()),
        "round": rnd,
        "last": last,
    }
    run.pages = [*pages, page]
    _add_host(run, url)
    return page


async def _request(
    db: AsyncSession, run: ApplyRun, kind: str, url: str, page_n: int
) -> ApplyRequest:
    # Older requests nobody took are dropped: only the newest page matters.
    await db.execute(
        update(ApplyRequest)
        .where(ApplyRequest.run_id == run.id, ApplyRequest.status == REQUEST_PENDING)
        .values(status=REQUEST_FAILED, result={"reason": "replaced"}, done_at=_now())
    )
    req = ApplyRequest(run_id=run.id, kind=kind, url=_text(url, 2000), page_n=page_n)
    db.add(req)
    await db.flush()
    return req


async def page_done(
    db: AsyncSession,
    user: User,
    run_id: str | None,
    page_url: str,
    page_title: str,
    answers: Any,
    *,
    last: bool = False,
) -> tuple[ApplyRun, dict[str, Any], ApplyRequest]:
    run = await for_agent(db, user.id, run_id)
    if not (page_url or "").startswith(("http://", "https://")):
        raise ValueError("page_url must be the page's full address (https://…).")
    if last and run.status not in (
        APPLY_FILLING,
        APPLY_NEEDS_YOU,
        APPLY_READING,
        APPLY_WRITING,
    ):
        raise ValueError("Only call ready_for_review while filling the application.")
    page = _new_page(run, page_url, page_title, answers, last=last)
    req = await _request(db, run, REQUEST_PHOTO, page_url, page["n"])
    if last:
        rnd = page["round"]
        run.review = {
            "round": rnd,
            "decision": None,
            "note": None,
            "by": None,
            "at": None,
        }
        _set(run, APPLY_REVIEW)
        _event(run, "review", f"Ready for your review (round {rnd}).")
    else:
        if run.status in (APPLY_READING, APPLY_QUESTIONS, APPLY_WRITING):
            _set(run, APPLY_FILLING)
        _event(run, "page", f"Page {page['n']} done: {page['title']}.")
    await db.flush()
    return run, page, req


async def fill_request(
    db: AsyncSession, user: User, run_id: str | None, page_url: str
) -> tuple[ApplyRun, ApplyRequest]:
    run = await for_agent(db, user.id, run_id)
    if not (page_url or "").startswith(("http://", "https://")):
        raise ValueError("page_url must be the page's full address (https://…).")
    if run.status in (APPLY_READING, APPLY_QUESTIONS, APPLY_WRITING):
        _set(run, APPLY_FILLING)
    _add_host(run, page_url)
    n = len(run.pages or []) + 1
    req = await _request(db, run, REQUEST_FILL, page_url, n)
    _event(run, "fill", f"Claude asked Job Catcher to fill page {n}.")
    await db.flush()
    return run, req


async def wait_request(
    db: AsyncSession, req_id: uuid.UUID, seconds: float | None = None
) -> dict:
    """Wait for Job Catcher to finish a request (or give up). Commits first so
    Job Catcher can see it; then reads only columns, so no stale cache."""
    await db.commit()
    deadline = asyncio.get_running_loop().time() + (
        WAIT_SECONDS if seconds is None else seconds
    )
    while True:
        row = (
            await db.execute(
                select(ApplyRequest.status, ApplyRequest.result).where(
                    ApplyRequest.id == req_id
                )
            )
        ).first()
        await db.commit()
        if row and row.status in (REQUEST_DONE, REQUEST_FAILED):
            return {"status": row.status, **(row.result or {})}
        if asyncio.get_running_loop().time() >= deadline:
            break
        await asyncio.sleep(POLL_SECONDS)
    # Nobody answered: close it so a late Job Catcher doesn't act on it.
    await db.execute(
        update(ApplyRequest)
        .where(
            ApplyRequest.id == req_id,
            ApplyRequest.status.in_((REQUEST_PENDING, REQUEST_WORKING)),
        )
        .values(status=REQUEST_FAILED, result={"reason": "no_answer"}, done_at=_now())
    )
    await db.commit()
    return {"status": REQUEST_FAILED, "reason": "no_answer"}


REASONS = {
    "no_answer": "Job Catcher didn't answer (is it on and signed in on this computer?)",
    "no_tab": "The tab wasn't showing",
    "not_visible": "The tab wasn't showing",
    "replaced": "A newer page came first",
    "error": "Job Catcher hit an error on this page",
}


async def photo_result(
    db: AsyncSession, user: User, run_id: uuid.UUID, page_n: int, res: dict
) -> dict[str, Any]:
    run = await _locked(db, user.id, run_id)
    ids = [
        str(i)
        for (i,) in await db.execute(
            select(ApplyPhoto.id)
            .where(ApplyPhoto.run_id == run.id, ApplyPhoto.page_n == page_n)
            .order_by(ApplyPhoto.part)
        )
    ]
    pages = [dict(p) for p in run.pages or []]
    page = next((p for p in pages if p["n"] == page_n), None)
    taken = res.get("status") == REQUEST_DONE and bool(ids)
    reason = (
        None
        if taken
        else REASONS.get(res.get("reason") or "", res.get("reason") or "No photo")
    )
    if page is not None:
        page.update(
            photo_ids=ids,
            photo="taken" if taken else "missing",
            reason=reason,
            jc_answers=_answers(res.get("answers")),
        )
        run.pages = pages
    blocked = sum(1 for e in run.events or [] if e.get("kind") == "blocked_submit")
    await db.flush()
    return {
        "run_id": str(run.id),
        "page": page_n,
        "photos": len(ids),
        "photo": "taken" if taken else f"missing: {reason}",
        "submit_presses_blocked": blocked,
    }


def fill_result(res: dict) -> dict[str, Any]:
    if res.get("status") != REQUEST_DONE:
        reason = res.get("reason") or ""
        return {
            "filled": None,
            "job_catcher": REASONS.get(reason, reason or "No answer"),
            "next": "Fill the page yourself, then call page_done.",
        }
    return {
        "filled": res.get("filled", []),
        "still_needs_an_answer": res.get("need", []),
        "next": (
            "Check every box Job Catcher filled, fill what's left yourself "
            "(answers you write get claude: true), then call page_done."
        ),
    }


async def wait_for_you(
    db: AsyncSession, user: User, run_id: str | None, seconds: float | None = None
) -> dict[str, Any]:
    """Wait (up to ~25 s) for whatever the run is waiting on from the user."""
    run = await for_agent(db, user.id, run_id)
    rid, user_id = run.id, user.id
    deadline = asyncio.get_running_loop().time() + (
        WAIT_SECONDS if seconds is None else seconds
    )
    while True:
        out = await _what_now(db, run)
        if out.get("ready") or asyncio.get_running_loop().time() >= deadline:
            await db.flush()
            return out
        await db.commit()
        await asyncio.sleep(POLL_SECONDS)
        run = await _locked(db, user_id, rid)
        if run.status in APPLY_ENDED:
            return {
                "run_id": str(rid),
                "waiting_on": None,
                "ready": True,
                "ended": run.status,
                "next": "The application ended in the app. Tell the user and stop.",
            }


async def _what_now(db: AsyncSession, run: ApplyRun) -> dict[str, Any]:
    base: dict[str, Any] = {"run_id": str(run.id)}
    if run.status == APPLY_QUESTIONS:
        qs = run.questions or []
        open_ = [q for q in qs if not q.get("answer") and not q.get("skipped")]
        if run.answers_done or not open_:
            if not run.answers_done:
                run.answers_done = True
            _set(run, APPLY_WRITING)
            return {
                **base,
                "waiting_on": "answers",
                "ready": True,
                "answers": [
                    {"question": q["question"], "answer": q.get("answer")}
                    for q in qs
                    if q.get("answer")
                ],
                "skipped": [q["question"] for q in qs if not q.get("answer")],
                "next": "Write the FULL résumé now and call save_resume (step 3).",
            }
        return {
            **base,
            "waiting_on": "answers",
            "ready": False,
            "open_questions": len(open_),
            "next": "Still waiting: call wait_for_you again.",
        }
    if run.status == APPLY_NEEDS_YOU:
        if (run.help or {}).get("done_at"):
            back = (run.help or {}).get("from") or APPLY_FILLING
            _set(
                run,
                back
                if back in APPLY_OPEN and back != APPLY_NEEDS_YOU
                else APPLY_FILLING,
            )
            run.help = {**run.help, "resolved": True}
            return {
                **base,
                "waiting_on": "help",
                "ready": True,
                "next": "The user says keep going. Carry on where you were.",
            }
        return {
            **base,
            "waiting_on": "help",
            "ready": False,
            "next": "Still waiting: call wait_for_you again.",
        }
    if run.status == APPLY_REVIEW:
        review = dict(run.review or {})
        decision = review.get("decision")
        if decision is None:
            return {
                **base,
                "waiting_on": "review",
                "ready": False,
                "next": "Still waiting for the user's review: call wait_for_you again.",
            }
        review["read"] = True
        run.review = review
        if decision == "submit":
            _set(run, APPLY_SUBMITTING)
            _event(run, "submitting", "Claude is pressing Submit.")
            return {
                **base,
                "waiting_on": "review",
                "ready": True,
                "decision": "submit",
                "next": (
                    "The user said submit. Press the final Submit button now, wait for "
                    "the confirmation page, then call "
                    "finish_apply(sent=true, page_url=…)."
                ),
            }
        if decision == "fix":
            _set(run, APPLY_FILLING)
            return {
                **base,
                "waiting_on": "review",
                "ready": True,
                "decision": "fix",
                "note": review.get("note"),
                "next": (
                    "Fix what the user said (go back to that page if needed), call "
                    "page_done for each page you change, then ready_for_review again."
                ),
            }
        return {
            **base,
            "waiting_on": "review",
            "ready": True,
            "decision": "self",
            "next": (
                "The user will press Submit themselves. Don't press it. Tell them "
                "it's ready and stop; the app finishes the run when they submit."
            ),
        }
    if run.status == APPLY_SUBMITTING:
        return {
            **base,
            "waiting_on": None,
            "ready": True,
            "next": "Press the final Submit, then call finish_apply.",
        }
    return {**base, "waiting_on": None, "ready": True, "next": _next(run)}


async def user_said(
    db: AsyncSession,
    user: User,
    run_id: str | None,
    *,
    answers: list[dict[str, Any]] | None,
    decision: str | None,
    note: str | None,
    keep_going: bool,
    answers_done: bool,
) -> dict[str, Any]:
    """What the user told Claude in a chat (Claude in Chrome, or the Claude app
    on the phone), recorded as if they'd pressed it in the app."""
    run = await for_agent(db, user.id, run_id)
    if answers or answers_done:
        if run.status != APPLY_QUESTIONS:
            raise ValueError("There are no open questions to answer.")
        await record_answers(db, run, answers or [], done=answers_done, source="chat")
    if keep_going:
        if run.status != APPLY_NEEDS_YOU or not run.help:
            raise ValueError("You didn't ask the user for help.")
        run.help = {**run.help, "done_at": _iso(_now())}
        _event(run, "help_done", "You told Claude to keep going.")
    if decision:
        await decide(db, run, decision, note, by="chat")
    if not (answers or answers_done or keep_going or decision):
        raise ValueError(
            "Pass what the user said: answers, decision (with note), or keep_going."
        )
    return await _what_now(db, run)


async def finish(
    db: AsyncSession,
    user: User,
    run_id: str | None,
    *,
    sent: bool,
    note: str | None,
    page_url: str | None,
) -> tuple[ApplyRun, ApplyRequest | None]:
    run = await for_agent(db, user.id, run_id)
    note = _text(note, 500) or None
    req = None
    if sent:
        ok = (run.review or {}).get("decision") in (
            "submit",
            "self",
        ) and run.status in (
            APPLY_SUBMITTING,
            APPLY_REVIEW,
        )
        if not ok:
            raise ValueError(
                "You can't finish as sent: the user hasn't said submit. Call "
                "ready_for_review and wait_for_you."
            )
        run.note = note
        if page_url and page_url.startswith(("http://", "https://")):
            page = _new_page(run, page_url, "Confirmation", [], last=False)
            req = await _request(db, run, REQUEST_PHOTO, page_url, page["n"])
        await _end_sent(db, run, "Sent. Your job is in Applied.")
    else:
        _set(run, APPLY_NOT_SENT)
        run.finished_at = _now()
        run.note = note or "Not sent."
        _event(run, "not_sent", f"Not sent: {run.note}")
    await db.flush()
    return run, req


# --------------------------------------------------------------------------- #
# Job Catcher's side
# --------------------------------------------------------------------------- #


def _guarded(run: ApplyRun) -> bool:
    """Submit buttons are blocked until the user's OK."""
    if run.status not in APPLY_OPEN:
        return False
    if run.status == APPLY_SUBMITTING:
        return False
    return not (
        run.status == APPLY_REVIEW
        and (run.review or {}).get("decision") in ("submit", "self")
    )


async def extension_state(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    run = await open_run(db, user_id)
    if run is None:
        return {"run_id": None}
    reqs = list(
        await db.scalars(
            select(ApplyRequest)
            .where(
                ApplyRequest.run_id == run.id, ApplyRequest.status == REQUEST_PENDING
            )
            .order_by(ApplyRequest.created_at)
            .limit(5)
        )
    )
    return {
        "run_id": str(run.id),
        "status": run.status,
        "guard": _guarded(run),
        "hosts": run.apply_hosts or [],
        "saved_job_id": str(run.saved_job_id),
        "requests": [
            {"id": str(r.id), "kind": r.kind, "url": r.url, "page_n": r.page_n}
            for r in reqs
        ],
    }


async def _own_request(
    db: AsyncSession, user_id: uuid.UUID, req_id: uuid.UUID
) -> ApplyRequest:
    req = await db.scalar(
        select(ApplyRequest)
        .join(ApplyRun, ApplyRun.id == ApplyRequest.run_id)
        .where(ApplyRequest.id == req_id, ApplyRun.user_id == user_id)
    )
    if req is None:
        raise LookupError("Request not found")
    return req


async def claim(
    db: AsyncSession, user_id: uuid.UUID, req_id: uuid.UUID
) -> ApplyRequest:
    req = await _own_request(db, user_id, req_id)
    res = await db.execute(
        update(ApplyRequest)
        .where(ApplyRequest.id == req.id, ApplyRequest.status == REQUEST_PENDING)
        .values(status=REQUEST_WORKING)
    )
    if not res.rowcount:
        raise ValueError("Already taken")
    await db.refresh(req)
    return req


async def add_photo(
    db: AsyncSession, user_id: uuid.UUID, req_id: uuid.UUID, part: int, data: bytes
) -> ApplyPhoto:
    req = await _own_request(db, user_id, req_id)
    if req.kind != REQUEST_PHOTO or req.status != REQUEST_WORKING:
        raise ValueError("This request isn't taking photos.")
    if not 0 <= part < MAX_PARTS:
        raise ValueError(f"At most {MAX_PARTS} photos per page.")
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise ValueError("A photo must be under 400 KB.")
    if not data.startswith(b"\xff\xd8\xff"):
        raise ValueError("Photos must be JPEG.")
    old = await db.scalar(
        select(ApplyPhoto).where(
            ApplyPhoto.run_id == req.run_id,
            ApplyPhoto.page_n == req.page_n,
            ApplyPhoto.part == part,
        )
    )
    if old is not None:
        await db.delete(old)
    photo = ApplyPhoto(
        run_id=req.run_id,
        user_id=user_id,
        page_n=req.page_n,
        part=part,
        data=data,
        size=len(data),
    )
    db.add(photo)
    await db.flush()
    return photo


async def finish_request(
    db: AsyncSession, user_id: uuid.UUID, req_id: uuid.UUID, payload: dict[str, Any]
) -> ApplyRequest:
    req = await _own_request(db, user_id, req_id)
    if req.status != REQUEST_WORKING:
        raise ValueError("This request isn't being worked on.")
    ok = bool(payload.get("ok"))
    result: dict[str, Any] = {"reason": _text(payload.get("reason"), 60) or None}
    if req.kind == REQUEST_FILL:
        result["filled"] = [
            _text(x, 200) for x in (payload.get("filled") or [])[:MAX_ANSWERS]
        ]
        result["need"] = [
            _text(x, 200) for x in (payload.get("need") or [])[:MAX_ANSWERS]
        ]
    else:
        result["answers"] = _answers(payload.get("answers"))
    req.status = REQUEST_DONE if ok else REQUEST_FAILED
    req.result = result
    req.done_at = _now()
    await db.flush()
    return req


async def extension_event(
    db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID, kind: str, url: str | None
) -> ApplyRun:
    run = await _locked(db, user_id, run_id)
    if run.status not in APPLY_OPEN:
        return run
    host = _host(url)
    if kind == "blocked_submit":
        _event(
            run,
            "blocked_submit",
            f"Job Catcher stopped a Submit press on {host or 'the page'}.",
        )
    elif kind == "submit_pressed":
        if run.status == APPLY_REVIEW and (run.review or {}).get("decision") == "self":
            await _end_sent(db, run, "You pressed Submit. Your job is in Applied.")
        else:
            _event(
                run, "submit_pressed", f"Submit was pressed on {host or 'the page'}."
            )
    else:
        raise ValueError("Unknown event")
    await db.flush()
    return run


async def photo_bytes(
    db: AsyncSession, user_id: uuid.UUID, photo_id: uuid.UUID
) -> bytes:
    data = await db.scalar(
        select(ApplyPhoto.data).where(
            ApplyPhoto.id == photo_id, ApplyPhoto.user_id == user_id
        )
    )
    if data is None:
        raise LookupError("Photo not found")
    return data


async def runs_for_job(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID
) -> list[ApplyRun]:
    await _expire_stale(db, user_id)
    return list(
        await db.scalars(
            select(ApplyRun)
            .where(ApplyRun.user_id == user_id, ApplyRun.saved_job_id == saved_job_id)
            .order_by(ApplyRun.created_at.desc())
            .limit(10)
        )
    )


__all__ = [
    "APPLY_ENDED",
    "APPLY_NOT_SENT",
    "APPLY_SENT",
    "APPLY_STOPPED",
    "RunBusy",
]
