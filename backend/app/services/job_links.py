"""Tie an email to the saved job it's really about, when the scan couldn't.

Two places the user can say "this is the same job":

- **A job made from an email** ("Same job as…"): :func:`link_job` moves its
  emails onto the real job, moves that job forward to the further stage of the
  two (never back), and archives the email-made copy. :func:`unlink_job` puts
  everything back.
- **An update about a job that isn't saved** ("Pick the job"):
  :func:`link_event` puts the email on the chosen job and moves its card
  forward, like an approved update. :func:`unlink_event` reverses it.
- **After every scan**, :func:`promote_unsaved` places the updates that fit
  exactly one saved job (exact company, same role, not from long before the
  job was saved) by itself; "Wrong job" (:func:`unlink_event`) undoes that and
  remembers the answer.

Either way the email becomes an approved update on the real job, so the
sender is remembered: their next email goes to that job by itself.

:func:`rank_jobs` orders the user's saved jobs for the picker from what the app
kept about the emails (sender, subject, the names it read), never the body.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import UTC, datetime, timedelta
from email.utils import parseaddr

from fastapi import HTTPException
from rapidfuzz import fuzz
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import (
    STATUS_APPLIED,
    STATUS_AUTO_APPLIED,
    STATUS_DISMISSED,
    STATUS_HIDDEN,
    STATUS_PENDING,
    STATUS_UNSAVED,
    DetectedEvent,
)
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import ORIGIN_EMAIL, SavedJob
from app.schemas.job_link import JobOption, LinkResult, LinkUndo, MovedEvent
from app.services.email_job_names import clean_role, is_sender_person
from app.services.email_match import (
    _DATE_SLACK,
    FUZZY_COMPANY,
    LIKELY_JOB,
    NOT_THIS_JOB,
    _company_terms,
    _domain_labels,
    _is_platform_company,
    _name_words,
    _same_company,
    _title_close,
    collapse_duplicates,
    company_initials,
)
from app.services.email_scan import _stage_orders, card_action
from app.services.tracker import move_job_to_stage

LIKELY = 3  # the score at which a job is shown as a likely match
LINKED = "user_link"  # match_evidence of an update the user put on a job
_RECENT = timedelta(days=120)


def _score(
    job: dict, *, company: str, title: str, subjects: str, labels: list[str]
) -> tuple[int, bool]:
    """How well one saved job fits what the emails say, and whether anything
    points at its company (a title alone is never enough for "likely")."""
    score = 0
    name = job.get("company") or ""
    _, rare, squashed = _company_terms(name)
    initials = company_initials(name)
    if company and _same_company(company, name):
        score += 4
    elif company and fuzz.token_sort_ratio(company.lower(), name.lower()) >= 90:
        score += 3
    # The sender's own domain: careers.vellacor.example, dhs.example.gov.
    if any(
        label in (squashed, initials) or (len(label) >= 5 and label in rare)
        for label in labels
    ):
        score += 4
    words = re.findall(r"[a-z0-9]+", f"{subjects} {company}".lower())
    capitals = re.findall(r"\b[A-Z]{3,8}\b", subjects)
    if (initials and initials.upper() in capitals) or (
        rare and all(t in words for t in rare)
    ):
        score += 3
    named = score > 0
    # The title: what the email's name says, or the whole title in a subject.
    job_title = re.findall(r"[a-z0-9]+", (job.get("title") or "").lower())
    said = re.findall(r"[a-z0-9]+", subjects.lower())
    if (title and fuzz.token_sort_ratio(title.lower(), " ".join(job_title)) >= 85) or (
        len(job_title) >= 2 and f" {' '.join(job_title)} " in f" {' '.join(said)} "
    ):
        score += 3
    applied = job.get("applied_at")
    if score and applied and applied >= datetime.now(tz=UTC) - _RECENT:
        score += 1  # a recent application is likelier to get a reply
    return score, named


def rank_jobs(
    jobs: list[dict],
    *,
    company: str = "",
    title: str = "",
    subjects: list[str] = (),
    senders: list[str] = (),
) -> list[dict]:
    """Every job, likeliest first; each gets ``likely`` when the emails point
    at it. The rest follow newest application first, then newest saved."""
    labels = _domain_labels([parseaddr(s)[1].lower() for s in senders if s])
    text = "\n".join(subjects)
    scored = [
        (_score(j, company=company, title=title, subjects=text, labels=labels), j)
        for j in jobs
    ]

    def newest(j: dict) -> tuple:
        applied, saved = j.get("applied_at"), j.get("saved_at")
        return (
            applied is not None,
            applied or saved or datetime.min.replace(tzinfo=UTC),
        )

    scored.sort(key=lambda sj: (sj[0][0], newest(sj[1])), reverse=True)
    return [{**j, "likely": named and s >= LIKELY} for (s, named), j in scored]


async def active_jobs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's active saved jobs with the names they see."""
    rows = (
        await db.execute(
            select(
                SavedJob.id,
                SavedJob.job_listing_id,
                SavedJob.pipeline_stage_id,
                SavedJob.applied_at,
                SavedJob.created_at,
                SavedJob.origin,
                func.coalesce(SavedJob.custom_company, JobListing.company).label(
                    "company"
                ),
                func.coalesce(SavedJob.custom_title, JobListing.title).label("title"),
                func.coalesce(SavedJob.custom_location, JobListing.location).label(
                    "location"
                ),
                PipelineStage.name.label("stage"),
            )
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .outerjoin(PipelineStage, SavedJob.pipeline_stage_id == PipelineStage.id)
            .where(SavedJob.user_id == user_id, SavedJob.is_archived.is_(False))
        )
    ).all()
    return [
        {
            "id": r.id,
            "job_listing_id": r.job_listing_id,
            "pipeline_stage_id": r.pipeline_stage_id,
            "company": r.company,
            "title": r.title,
            "location": r.location,
            "stage": r.stage,
            "origin": r.origin,
            "applied_at": _aware(r.applied_at),
            "saved_at": _aware(r.created_at),
        }
        for r in rows
    ]


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when and when.tzinfo is None else when


def _options(ranked: list[dict]) -> list[JobOption]:
    return [
        JobOption(
            saved_job_id=j["id"],
            title=j["title"],
            company=j["company"],
            location=j["location"] if j["location"] != "Not specified" else None,
            stage=j["stage"],
            likely=j["likely"],
        )
        for j in ranked
    ]


async def _own_job(db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> SavedJob:
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise HTTPException(status_code=404, detail="Saved job not found")
    return sj


async def _events_of(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> list[DetectedEvent]:
    return list(
        await db.scalars(
            select(DetectedEvent).where(
                DetectedEvent.user_id == user_id, DetectedEvent.saved_job_id == job_id
            )
        )
    )


# --------------------------------------------------------------------------- #
# A job made from an email
# --------------------------------------------------------------------------- #
async def job_options(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> list[JobOption]:
    """The jobs an email-made job could really be, likeliest first."""
    sj = await _own_job(db, user_id, job_id)
    jobs = await active_jobs(db, user_id)
    me = next((j for j in jobs if j["id"] == sj.id), None)
    events = await _events_of(db, user_id, sj.id)
    ranked = rank_jobs(
        [j for j in jobs if j["id"] != sj.id],
        company=(me or {}).get("company") or "",
        title=(me or {}).get("title") or "",
        subjects=[e.subject for e in events],
        senders=[e.from_addr for e in events],
    )
    return _options(ranked)


async def link_job(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, target_id: uuid.UUID
) -> LinkResult:
    """The email-made job ``job_id`` is really ``target_id``: move its emails
    there, move that card forward if the email got further, archive the copy."""
    if job_id == target_id:
        raise HTTPException(status_code=422, detail="Pick a different job")
    dup = await _own_job(db, user_id, job_id)
    target = await _own_job(db, user_id, target_id)
    if dup.origin != ORIGIN_EMAIL:
        raise HTTPException(
            status_code=409, detail="Only a job made from an email can be linked"
        )
    if dup.is_archived or target.is_archived:
        raise HTTPException(status_code=409, detail="That job was already removed")

    before_stage = target.pipeline_stage_id
    applied_set = target.applied_at is None and dup.applied_at is not None
    if applied_set:  # the copy's date, before a move to Applied stamps "now"
        target.applied_at = dup.applied_at
    by_name, order = await _stage_orders(db, user_id)
    mine, theirs = order.get(dup.pipeline_stage_id), order.get(target.pipeline_stage_id)
    moved_stage = mine is not None and (theirs is None or mine > theirs)
    if moved_stage:
        await move_job_to_stage(db, target.id, dup.pipeline_stage_id, user_id)

    moved = []
    for ev in await _events_of(db, user_id, dup.id):
        moved.append(
            MovedEvent(
                id=ev.id, previous_stage_id=ev.previous_stage_id, status=ev.status
            )
        )
        ev.saved_job_id = target.id
        # The email's own Undo now puts the REAL job back where it was.
        ev.previous_stage_id = before_stage
        # A waiting update that the real job is already at or past would
        # drag it back if approved: it's done with.
        if ev.status == STATUS_PENDING:
            _, why = card_action(
                ev.target_stage,
                by_name,
                current_order=order.get(target.pipeline_stage_id),
                reminder=False,
            )
            if why == "already_at_or_past_stage":
                ev.status = STATUS_DISMISSED
    dup.is_archived = True
    await db.flush()
    return LinkResult(
        saved_job_id=target.id,
        job_listing_id=target.job_listing_id,
        stage=await _stage_name(db, target.pipeline_stage_id),
        undo=LinkUndo(
            target_id=target.id,
            events=moved,
            previous_stage_id=before_stage if moved_stage else None,
            stage_moved=moved_stage,
            applied_set=applied_set,
        ),
    )


async def unlink_job(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, undo: LinkUndo
) -> None:
    """Undo :func:`link_job`: the copy comes back with its emails, and the real
    job goes back to the stage it had (unless it has moved since)."""
    if job_id == undo.target_id:
        raise HTTPException(status_code=422, detail="Nothing to undo")
    dup = await _own_job(db, user_id, job_id)
    target = await _own_job(db, user_id, undo.target_id)
    if dup.origin != ORIGIN_EMAIL or not dup.is_archived:
        raise HTTPException(status_code=409, detail="Nothing to undo")
    _, order = await _stage_orders(db, user_id)
    for item in undo.events:
        ev = await db.scalar(
            select(DetectedEvent).where(
                DetectedEvent.id == item.id,
                DetectedEvent.user_id == user_id,
                DetectedEvent.saved_job_id == target.id,
            )
        )
        if ev is None:
            continue
        ev.saved_job_id = dup.id
        # A stage deleted since is no place to go back to.
        back = item.previous_stage_id
        ev.previous_stage_id = back if back in order else None
        if item.status == STATUS_PENDING and ev.status == STATUS_DISMISSED:
            ev.status = STATUS_PENDING  # set aside by the link: waiting again
    if undo.stage_moved and target.pipeline_stage_id == dup.pipeline_stage_id:
        back = undo.previous_stage_id
        await move_job_to_stage(db, target.id, back if back in order else None, user_id)
    if undo.applied_set:  # the link gave it the copy's applied date
        target.applied_at = None
    dup.is_archived = False
    await db.flush()


async def _stage_name(db: AsyncSession, stage_id: uuid.UUID | None) -> str | None:
    if stage_id is None:
        return None
    return await db.scalar(
        select(PipelineStage.name).where(PipelineStage.id == stage_id)
    )


# --------------------------------------------------------------------------- #
# An update about a job that isn't saved
# --------------------------------------------------------------------------- #
async def _unsaved_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    ev = await db.scalar(
        select(DetectedEvent).where(
            DetectedEvent.id == event_id, DetectedEvent.user_id == user_id
        )
    )
    if ev is None:
        raise HTTPException(status_code=404, detail="Update not found")
    if ev.status != STATUS_UNSAVED:
        raise HTTPException(status_code=409, detail="This update is already handled")
    return ev


def _event_facts(ev: DetectedEvent) -> dict:
    """What placement reads about an update: the company and role it named
    (never the sender's own name, never a sentence), sender and subject."""
    company = (ev.job_company or "").strip()
    if not company[:1].isalnum() or is_sender_person(company, ev.from_addr):
        company = ""
    title = clean_role(ev.job_title, strict=False) if ev.job_title else None
    addr = parseaddr(ev.from_addr or "")[1].lower()
    return {
        "id": ev.id,
        "company": company,
        "title": title or "",
        "subject": ev.subject or "",
        "addr": addr,
        "labels": _domain_labels([addr]) if addr else [],
        "date": _aware(ev.email_date),
        "target": ev.target_stage,
    }


def _company_of(ev: dict, job: dict) -> bool:
    """The email is about THIS job's company, exactly: the company it named is
    the job's, or, when it named none, the sender writes from the company's own
    domain or the subject has its whole (two-word or longer) name. One word
    in a subject ("Target start date") is never enough, and a job site saved
    as the company (Indeed) never counts."""
    name = job.get("company") or ""
    if _is_platform_company(job):
        return False
    if ev["company"]:
        return _same_company(ev["company"], name)
    _, rare, squashed = _company_terms(name)
    initials = company_initials(name)
    for label in ev["labels"]:
        if label in (squashed, initials) or (len(label) >= 5 and label in rare):
            return True
    words = _name_words(name)
    said = " " + " ".join(re.findall(r"[a-z0-9]+", ev["subject"].lower())) + " "
    return len(words) >= 2 and f" {' '.join(words)} " in said


def _fits(ev: dict, job: dict) -> bool:
    """Company exact, the role (if the email named one) is this job's, and the
    email isn't from long before the job was saved."""
    if not _company_of(ev, job):
        return False
    if ev["title"] and not _title_close(ev["title"], job.get("title") or ""):
        return False  # another role at the company
    saved, when = job.get("saved_at"), ev["date"]
    # By company alone, an email from well before the job was saved is about
    # an earlier application there, not this one (spec 028).
    slack = _DATE_SLACK if ev["title"] else _COMPANY_ONLY_SLACK
    return not (saved and when and when < saved - slack)


_COMPANY_ONLY_SLACK = timedelta(days=14)


def place(events: list[dict], jobs: list[dict], excluded: dict) -> dict:
    """event id -> the one saved job it is about, for the updates that fit
    exactly one job (duplicate saves count as one). ``excluded`` maps an event
    id to jobs the user said it's not. Pure, so a scan runs it off the event
    loop."""
    reps, _ = collapse_duplicates(jobs)
    out = {}
    for ev in events:
        fits = [
            j
            for j in reps
            if j["id"] not in excluded.get(ev["id"], ()) and _fits(ev, j)
        ]
        if len(fits) == 1:
            out[ev["id"]] = fits[0]
    return out


def _company_key(name: str | None) -> str:
    return _company_terms(name or "")[2]


async def _exclusions(
    db: AsyncSession, user_id: uuid.UUID, events: list[DetectedEvent]
) -> dict:
    """Jobs the user said each update is NOT about: its own "Wrong job"
    answers, plus those for any other email from the same sender or company,
    so one answer covers that recruiter's later emails too."""
    said_no = list(
        await db.scalars(
            select(DetectedEvent).where(
                DetectedEvent.user_id == user_id,
                DetectedEvent.not_jobs.is_not(None),
            )
        )
    )
    by_addr: dict[str, set] = {}
    by_company: dict[str, set] = {}
    for r in said_no:
        jobs = {uuid.UUID(str(j)) for j in r.not_jobs or []}
        if addr := parseaddr(r.from_addr or "")[1].lower():
            by_addr.setdefault(addr, set()).update(jobs)
        if key := _company_key(r.job_company):
            by_company.setdefault(key, set()).update(jobs)
    out = {}
    for ev in events:
        addr = parseaddr(ev.from_addr or "")[1].lower()
        out[ev.id] = by_addr.get(addr, set()) | by_company.get(
            _company_key(ev.job_company), set()
        )
    return out


async def promote_unsaved(db: AsyncSession, user_id: uuid.UUID) -> list[DetectedEvent]:
    """After a scan, put each unsaved update the app can now place on its job.

    An update goes on a saved job only when it fits that job alone (see
    :func:`place`), never when the scan judged it a look-alike company, and
    never once the user said "Wrong job". It becomes a pending update
    (``LIKELY_JOB``); with auto-move on the scan then moves the card like any
    sure match. Older updates are placed too, so saving a job later clears the
    leftovers about it. One the job is already at or past is kept with the job
    (hidden): nothing to move. Returns the new pending updates."""
    events = list(
        await db.scalars(
            select(DetectedEvent)
            .where(
                DetectedEvent.user_id == user_id,
                DetectedEvent.status == STATUS_UNSAVED,
                or_(
                    DetectedEvent.match_evidence.is_(None),
                    DetectedEvent.match_evidence.not_in((FUZZY_COMPANY, NOT_THIS_JOB)),
                ),
            )
            .order_by(DetectedEvent.email_date.asc().nulls_first())
        )
    )
    if not events:
        return []
    jobs = await active_jobs(db, user_id)
    by_name, by_id = await _stage_orders(db, user_id)
    excluded = await _exclusions(db, user_id, events)
    facts = [_event_facts(ev) for ev in events if ev.target_stage in by_name]
    placed = await asyncio.to_thread(place, facts, jobs, excluded)
    # Where each card will be once the earlier updates move it.
    reached = {j["id"]: by_id.get(j["pipeline_stage_id"]) for j in jobs}
    pending = []
    for ev in events:
        job = placed.get(ev.id)
        if job is None:
            continue
        move, _ = card_action(
            ev.target_stage, by_name, current_order=reached[job["id"]], reminder=False
        )
        ev.saved_job_id = job["id"]
        ev.previous_stage_id = job["pipeline_stage_id"]
        ev.match_evidence = LIKELY_JOB
        if move:
            ev.status = STATUS_PENDING
            reached[job["id"]] = by_name[ev.target_stage]
            pending.append(ev)
        else:
            ev.status = STATUS_HIDDEN
    await db.flush()
    return pending


async def event_options(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> list[JobOption]:
    """The saved jobs an unsaved update could be about, likeliest first."""
    ev = await _unsaved_event(db, user_id, event_id)
    ranked = rank_jobs(
        await active_jobs(db, user_id),
        company=ev.job_company or "",
        title=ev.job_title or "",
        subjects=[ev.subject],
        senders=[ev.from_addr],
    )
    return _options(ranked)


async def link_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID, saved_job_id: uuid.UUID
) -> DetectedEvent:
    """The update is about this saved job: put it there, and move the card
    forward to the stage the email describes (never back)."""
    ev = await _unsaved_event(db, user_id, event_id)
    job = await _own_job(db, user_id, saved_job_id)
    if job.is_archived:
        raise HTTPException(status_code=404, detail="Saved job not found")
    by_name, by_id = await _stage_orders(db, user_id)
    move, _ = card_action(
        ev.target_stage,
        by_name,
        current_order=by_id.get(job.pipeline_stage_id),
        reminder=False,
    )
    ev.previous_stage_id = job.pipeline_stage_id
    if move and ev.target_stage in by_name:
        stage_id = await db.scalar(
            select(PipelineStage.id).where(
                PipelineStage.user_id == user_id, PipelineStage.name == ev.target_stage
            )
        )
        await move_job_to_stage(db, job.id, stage_id, user_id)
    ev.saved_job_id = job.id
    ev.status = STATUS_APPLIED
    ev.applied_at = datetime.now(tz=UTC)
    ev.match_evidence = LINKED  # so Undo can make it an unsaved update again
    await db.flush()
    return ev


async def unlink_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Wrong job: undo the user's own link (:func:`link_event`) or the app's
    placement (:func:`promote_unsaved`). The email is an unsaved update again,
    to put on the right job or add as a new one, and is never placed on this
    job again (nor are later emails from the same sender or company).

    Undoing a placement also undoes the app's other placements on this job
    from the same sender or company, and puts the card back where it was
    before any of them, as long as it hasn't been moved since."""
    ev = await db.scalar(
        select(DetectedEvent).where(
            DetectedEvent.id == event_id, DetectedEvent.user_id == user_id
        )
    )
    if ev is None:
        raise HTTPException(status_code=404, detail="Update not found")
    if ev.match_evidence not in (LINKED, LIKELY_JOB) or ev.status not in (
        STATUS_APPLIED,
        STATUS_AUTO_APPLIED,
        STATUS_PENDING,
        STATUS_HIDDEN,
    ):
        raise HTTPException(status_code=409, detail="Nothing to undo")
    job = await _own_job(db, user_id, ev.saved_job_id)
    undo = [ev]
    if ev.match_evidence == LIKELY_JOB:
        addr = parseaddr(ev.from_addr or "")[1].lower()
        company = _company_key(ev.job_company)
        for other in await _events_of(db, user_id, job.id):
            if other.id == ev.id or other.match_evidence != LIKELY_JOB:
                continue
            if (addr and parseaddr(other.from_addr or "")[1].lower() == addr) or (
                company and _company_key(other.job_company) == company
            ):
                undo.append(other)

    stages = {
        s.name: s
        for s in await db.scalars(
            select(PipelineStage).where(PipelineStage.user_id == user_id)
        )
    }
    order = {s.id: s.sort_order for s in stages.values()}
    # Latest stage first: each step back lands where the earlier one put it.
    undo.sort(
        key=lambda e: (
            -(stages[e.target_stage].sort_order if e.target_stage in stages else -1)
        )
    )
    for one in undo:
        moved = one.status in (STATUS_APPLIED, STATUS_AUTO_APPLIED)
        target = stages.get(one.target_stage or "")
        back = one.previous_stage_id if one.previous_stage_id in order else None
        if moved and target is not None and job.pipeline_stage_id == target.id:
            if back != job.pipeline_stage_id:
                await move_job_to_stage(db, job.id, back, user_id)
        elif moved and target is not None:
            # The card has moved on since: whatever this update put in its
            # place's Undo now points past it, to where the card was before.
            for later in await _events_of(db, user_id, job.id):
                if later.id != one.id and later.previous_stage_id == target.id:
                    later.previous_stage_id = back
        one.saved_job_id = None
        one.previous_stage_id = None
        one.status = STATUS_UNSAVED
        one.applied_at = None
        # A placement the user rejected is never guessed again; their own
        # pick, undone, may still be placed elsewhere later.
        one.match_evidence = NOT_THIS_JOB if one.match_evidence == LIKELY_JOB else None
        one.not_jobs = sorted({*(one.not_jobs or []), str(job.id)})
    await db.flush()
    return ev
