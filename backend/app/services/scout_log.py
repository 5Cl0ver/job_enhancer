"""The run log: every connector call Claude makes during a Scout run (spec 010).

Each entry says, in one plain line, what happened, and keeps what Claude sent
and what the app answered, trimmed. The instruction texts are referenced, not
repeated, and the resume is never stored: reading it is logged as a fact only.
"""

import json
import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scout import RUN_RUNNING, ScoutRun, ScoutRunEvent
from app.services import bug_reports
from app.services import scout_instructions as instr
from app.services import scout_runs as runs
from app.services.apply_problems import scrub
from app.services.scout_review import SOURCE_LABEL

MAX_EVENTS = 400
MAX_DETAIL = 8000
MORE = "more"  # the one entry that counts calls past MAX_EVENTS
# Brief fields that carry instruction texts, and the section each one is.
_TEXT_FIELDS = {
    "playbook": "playbook",
    "broad_steps": "broad",
}
OUTCOME_WORDS = {
    "picked": "a good fit, waiting for you",
    "saved": "saved",
    "below_bar": "below your bar",
    "duplicate": "you already had it",
    "waiting_for_copy": "waiting for the page copy",
    "no_copy": "the page couldn't be copied",
    "rejected_link": "link turned down",
}


def _now() -> datetime:
    return datetime.now(UTC)


def trim(value) -> dict | None:
    """At most MAX_DETAIL characters of detail; past that, the start of it."""
    if value is None:
        return None
    if not isinstance(value, dict):
        value = {"value": value}
    raw = json.dumps(value, default=str)
    if len(raw) <= MAX_DETAIL:
        return json.loads(raw)
    return {"trimmed": raw[:MAX_DETAIL]}


def _ref(criteria: dict, key: str) -> str:
    when = ((criteria or {}).get("instructions") or {}).get(key)
    name = instr.TITLES[key]
    return f"[{name}: {'your edit of ' + when[:10] if when else 'original'}]"


def brief_view(out: dict, criteria: dict) -> dict:
    """The brief without its long instruction texts: each named by section and
    version instead."""
    view = dict(out)
    for field, key in _TEXT_FIELDS.items():
        if field in view:
            view[field] = _ref(criteria, key)
    if "source_steps" in view:
        view["source_steps"] = _ref(criteria, (criteria or {}).get("source", ""))
    return view


def _host(url: str) -> str:
    try:
        return (urlsplit(url or "").hostname or url or "").removeprefix("www.")
    except ValueError:
        return url or ""


def summarize(tool: str, sent: dict, out: dict | None, error: str | None) -> str:
    """One plain line for the log."""
    if error:
        return f"Refused: {error}"[:300]
    out = out or {}
    sent = sent or {}
    if tool == "get_scout_brief":
        where = SOURCE_LABEL.get(out.get("source", ""), out.get("source", ""))
        line = f"Gave Claude the brief for {where}"
        if out.get("broad") and not out.get("start_urls"):
            line += "; Claude picks the titles"
        line += "; resume ready" if out.get("resume_ready") else "; no resume"
        return line
    if tool == "set_search_titles":
        line = f"Claude chose {len(sent.get('titles') or [])} titles; searching "
        line += ", ".join(out.get("titles") or []) or "none"
        if out.get("dropped"):
            line += f" ({len(out['dropped'])} left out)"
        return line[:300]
    if tool == "check_jobs":
        skipped = out.get("skipped") or {}
        parts = [f"{len(out.get('open') or [])} to open"]
        for key, words in (
            ("seen_before", "seen before"),
            ("in_tracker", "already in My Jobs"),
            ("title_passed", "titles didn't fit"),
            ("excluded", "had a word you skip"),
            ("skipped_site", "on sites you skip"),
        ):
            if skipped.get(key):
                parts.append(f"{skipped[key]} {words}")
        page = out.get("pages_read")
        on = f" on page {page}" if page else ""
        return f"Checked {len(sent.get('rows') or [])} jobs{on}: " + ", ".join(parts)
    if tool == "report_job":
        outcome = out.get("outcome", "")
        return (
            f"Reported a job on {_host(sent.get('url', ''))}: scored "
            f"{sent.get('fit_score')}/10, {OUTCOME_WORDS.get(outcome, outcome)}"
        )[:300]
    if tool == "check_companies":
        return (
            f"Sent {len(sent.get('companies') or [])} companies: "
            f"{len(out.get('visit') or [])} to visit"
        )
    if tool == "company_checked":
        return f"Checked {_host(sent.get('website', ''))}: {sent.get('result', '')}"[
            :300
        ]
    if tool == "finish_scout_run":
        counts = out.get("counts") or {}
        kept = counts.get("picked", 0) + counts.get("saved", 0)
        return f"Finished: {kept} good fit{'s' if kept != 1 else ''}"
    if tool == "scout_needs_you":
        where = _host(sent.get("page_url") or "") or "The job board"
        words = runs.WALL_WORDS.get(sent.get("kind", ""), runs.WALL_WORDS["sign_in"])
        return f"{where} {words}: Claude asked you to, and waits"[:300]
    if tool == "get_master_profile":
        return "Read your resume (not stored here)"
    return tool


# What a refusal names (ids, titles, a user's own words) is left out of its
# kind: anything quoted, in brackets or parentheses, ids and numbers.
_QUOTED = re.compile(
    r"\"[^\"]*\"|“[^”]*”|‘[^’]*’|(?<!\w)'[^']*'(?!\w)"
    r"|\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}"
)
_IDS = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"
    r"|\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b",
    re.I,
)


def refusal_category(error: str) -> str:
    """What kind of refusal it was: its first sentence, with anything quoted
    or in brackets left out and ids and numbers as N, so the same refusal
    about two jobs (or two of the user's titles) is one, and names nothing."""
    first = re.split(r"(?<=[.!?])\s", str(error or "").strip(), maxsplit=1)[0]
    for _ in range(3):  # brackets inside brackets
        first = _QUOTED.sub("…", first)
    first = _IDS.sub("N", first)
    first = re.sub(r"\d+", "N", first)
    return re.sub(r"\s+", " ", scrub(first, 120)).strip() or "Refused"


async def _run(db: AsyncSession, user_id: uuid.UUID, run_id) -> ScoutRun | None:
    if run_id:
        try:
            rid = uuid.UUID(str(run_id))
        except ValueError:
            return None
        return await db.scalar(
            select(ScoutRun).where(ScoutRun.id == rid, ScoutRun.user_id == user_id)
        )
    return await runs.open_run(db, user_id)


async def _add(
    db: AsyncSession,
    run: ScoutRun,
    tool: str,
    summary: str,
    request: dict | None,
    response: dict | None,
    ok: bool,
) -> None:
    n = await db.scalar(select(func.count()).where(ScoutRunEvent.run_id == run.id)) or 0
    if n >= MAX_EVENTS:
        more = await db.scalar(
            select(ScoutRunEvent).where(
                ScoutRunEvent.run_id == run.id, ScoutRunEvent.tool == MORE
            )
        )
        if more is None:  # the cap's own entry replaces nothing
            return
        extra = int((more.response or {}).get("count", 0)) + 1
        more.response = {"count": extra}
        more.summary = f"{extra} more call{'s' if extra != 1 else ''} not logged"
        return
    if n == MAX_EVENTS - 1:  # the last slot counts what comes after
        tool, summary, request, response, ok = (
            MORE,
            "1 more call not logged",
            None,
            {"count": 1},
            True,
        )
    db.add(
        ScoutRunEvent(
            id=uuid.uuid4(),
            user_id=run.user_id,
            run_id=run.id,
            tool=tool,
            summary=summary[:300],
            request=trim(request),
            response=trim(response),
            ok=ok,
            created_at=_now(),
        )
    )
    await db.flush()


async def record(
    db: AsyncSession,
    user_id: uuid.UUID,
    run_id,
    tool: str,
    sent: dict,
    out: dict | None = None,
    error: str | None = None,
) -> None:
    """Log one Scout connector call on its run (none: nothing is logged). A
    refusal is also kept in Bugs & ideas (spec 032): the tool and the kind of
    refusal, never who or what was sent."""
    if error:
        category = refusal_category(error)
        await bug_reports.catch_safely(
            db,
            section="scout",
            kind="scout_refused",
            place=tool,
            message=category,
            key=category,
        )
    run = await _run(db, user_id, run_id or (out or {}).get("run_id"))
    if run is None:
        return
    response = {"error": error} if error else out
    if tool == "get_scout_brief" and out:
        response = brief_view(out, run.criteria)
    await _add(
        db,
        run,
        tool,
        summarize(tool, sent, out, error),
        sent,
        response,
        ok=error is None,
    )


async def record_resume_read(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Claude read the resume: logged on the running search, if one is going.
    Never the resume itself."""
    run = await runs.open_run(db, user_id)  # the run Claude is working on
    if run is not None and run.status == RUN_RUNNING:
        await _add(
            db,
            run,
            "get_master_profile",
            summarize("get_master_profile", {}, None, None),
            None,
            None,
            ok=True,
        )


async def events(
    db: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID
) -> list[ScoutRunEvent]:
    await runs.get_run(db, run_id, user_id)  # 404 unless it's theirs
    return list(
        await db.scalars(
            select(ScoutRunEvent)
            .where(ScoutRunEvent.run_id == run_id, ScoutRunEvent.user_id == user_id)
            .order_by(ScoutRunEvent.created_at, ScoutRunEvent.id)
        )
    )
