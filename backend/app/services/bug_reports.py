"""Bugs & ideas (spec 032): the owner's one inbox for every bug and idea.

Every rule lives here; the admin routes (``api/v1/admin_bugs.py``), the
attention count and Apply with Claude's ``report_problem`` all call it.

- **One format.** A report is a bug or an idea with a title, a section, where
  it happened, steps, what happened, what was expected, a severity (bugs), its
  source and the context filled in for the owner. No user is ever stored.
- **Everything scrubbed and capped** with ``apply_problems.scrub``: passwords,
  codes, emails, phone, card and SSN numbers and key blobs never get in.
- **Repeats merge.** Claude's run problems carry a plain fingerprint
  (section, kind, site and the start of the text; research R3), so the same
  one again counts up instead of adding a report.
- **Came back.** A fixed report seen again is new again, flagged with when
  (research R4); won't-fix ones only count up.
- **Priority** is worked out when the list is read: pinned, severity, came
  back, count, last seen (research R5).
- **History.** Every change is an event (who and when), and so are notes,
  links, merges and every time a report was seen (the newest 20 are kept).
- **Screenshots** are kept as bytes, at most 3 a report, checked by their
  first bytes (JPEG, PNG or WebP) and never over 1 MB (research R1).
- **Repeat suggestions.** A report the owner (or their AI) writes gets up to
  3 open reports in its section with a close title (research R3).
- **Caught errors** (research R6): server errors, browser crashes, Job
  Catcher failures, email checks, Scout refusals and services going down are
  kept with no user, merged by fingerprint, and capped an hour (the
  server's own and the ones the app and Job Catcher send, apart).
  Keeping one can never raise or loop: a failure there is only logged.
"""

import asyncio
import hashlib
import logging
import re
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from rapidfuzz import fuzz, utils
from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.apply import ApplyRun
from app.models.bug_report import (
    BUG,
    BUG_OPEN,
    BUG_STATUSES,
    CONFIDENCE,
    IDEA,
    IDEA_OPEN,
    IDEA_STATUSES,
    SECTIONS,
    SEVERITIES,
    TYPES,
    BugReport,
    BugReportEvent,
    BugReportLink,
    BugReportShot,
)
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.services.apply_problems import host_of, scrub
from app.version import api_version

logger = logging.getLogger(__name__)

TITLE_MAX = 140
PLACE_MAX = 300
BOX_MAX = 200
STEP_MAX = 300
STEPS_MAX = 12
ACTUAL_MAX = 2000
EXPECTED_MAX = 1000
NOTE_MAX = 1000
FIXED_IN_MAX = 60
CONTEXT_MAX = 80
CONTEXT_KEYS = (
    "device",
    "browser",
    "theme",
    "app_version",
    "api_version",
    "job_catcher",
    "playbook",
)
SEEN_KEPT = 20
EVENTS_SHOWN = 100
LIST_MAX = 200
BULK_MAX = 100
# A merged-away report points at the one it went into; never deeper than this.
MERGE_HOPS = 5

# The fields the owner can change, and how each is cleaned.
_TEXT_FIELDS = {
    "title": TITLE_MAX,
    "box": BOX_MAX,
    "actual": ACTUAL_MAX,
    "expected": EXPECTED_MAX,
    "fixed_in": FIXED_IN_MAX,
}
_MULTILINE = ("actual", "expected")
_UUID_SEG = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
_ID_SEG = re.compile(r"^(\d+|[0-9a-f]{12,})$", re.I)
_TOKEN_SEG = re.compile(r"^[A-Za-z0-9_-]{16,}$")


def _is_token(seg: str) -> bool:
    """A long code in the path (a reset or session token, a key): letters
    and digits mixed all through it. A job slug ("Senior-Engineer_R0012345")
    switches between them once or twice, so it stays."""
    if not _TOKEN_SEG.match(seg):
        return False
    chars = [c for c in seg if c.isalnum()]
    switches = sum(
        1 for a, b in zip(chars, chars[1:], strict=False) if a.isdigit() != b.isdigit()
    )
    return switches >= 4


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _aware(at: datetime | None) -> datetime | None:
    # SQLite hands datetimes back without their zone; they're all UTC.
    if at is None:
        return None
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _iso(at: datetime | None) -> str | None:
    at = _aware(at)
    return at.isoformat() if at else None


def statuses_for(kind: str) -> tuple[str, ...]:
    return BUG_STATUSES if kind == BUG else IDEA_STATUSES


def open_statuses(kind: str) -> tuple[str, ...]:
    return BUG_OPEN if kind == BUG else IDEA_OPEN


# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #


def clean_place(value: Any) -> str | None:
    """Where it happened, never with a query or fragment, and with ids as
    ``:id`` so the same page in two reports reads the same
    (``/jobs/3f2…`` is ``/jobs/:id``). A web page keeps its site."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme and parts.scheme not in ("http", "https"):
        return None
    segs = [
        ":id" if (_UUID_SEG.match(s) or _ID_SEG.match(s) or _is_token(s)) else s
        for s in parts.path.split("/")
    ]
    path = "/".join(segs)
    site = (parts.hostname or "").removeprefix("www.") if parts.scheme else ""
    out = scrub(f"{site}{path}" if site else path, PLACE_MAX)
    return out or None


def clean_steps(steps: Any) -> list[str]:
    out = [scrub(s, STEP_MAX) for s in (steps or [])[:STEPS_MAX]]
    return [s for s in out if s]


def clean_context(context: Any) -> dict[str, str]:
    """The context filled in for the owner: known keys only, short."""
    if not isinstance(context, dict):
        return {}
    out = {}
    for key in CONTEXT_KEYS:
        value = scrub(context.get(key), CONTEXT_MAX)
        if value:
            out[key] = value
    return out


def _clean(field: str, value: Any) -> Any:
    if field in _TEXT_FIELDS:
        text = scrub(value, _TEXT_FIELDS[field], lines=field in _MULTILINE)
        return text or (None if field in ("box", "fixed_in") else "")
    if field == "place":
        return clean_place(value)
    if field == "steps":
        return clean_steps(value)
    return value


def fingerprint(section: str, kind: str, place: str) -> str:
    """Plain, deterministic, no AI: the same section, kind and place are the
    same problem (research R3)."""
    return hashlib.sha1(f"{section}|{kind}|{place}".encode()).hexdigest()[:16]


def run_fingerprint(section: str, kind: str, site: str | None, text: str) -> str:
    """A run problem's: its kind, the site and the start of what Claude said.
    The migration that brought old problems in uses the same."""
    return fingerprint(section, kind, f"{site or ''}|{text[:60].lower()}")


# --------------------------------------------------------------------------- #
# Events
# --------------------------------------------------------------------------- #


def _event(
    db: AsyncSession, report: BugReport, kind: str, by: str, data: dict[str, Any]
) -> BugReportEvent:
    ev = BugReportEvent(
        id=uuid.uuid4(),
        report_id=report.id,
        kind=kind,
        actor=by,
        at=_now(),
        data=data,
    )
    db.add(ev)
    return ev


async def _prune_seen(db: AsyncSession, report_id: uuid.UUID) -> None:
    """Keep the newest 20 ``seen`` events; ``count`` keeps the true total."""
    keep = (
        select(BugReportEvent.id)
        .where(BugReportEvent.report_id == report_id, BugReportEvent.kind == "seen")
        .order_by(BugReportEvent.at.desc())
        .limit(SEEN_KEPT)
    )
    await db.execute(
        delete(BugReportEvent)
        .where(
            BugReportEvent.report_id == report_id,
            BugReportEvent.kind == "seen",
            BugReportEvent.id.not_in(keep.scalar_subquery()),
        )
        .execution_options(synchronize_session=False)
    )


async def _add_count(db: AsyncSession, report: BugReport, n: int) -> None:
    """Count up in the database itself (``count = count + n``), so two at
    once both count; the object is refreshed after."""
    await db.flush()
    await db.execute(
        update(BugReport)
        .where(BugReport.id == report.id)
        .values(count=BugReport.count + n)
        .execution_options(synchronize_session=False)
    )
    await db.refresh(report, ["count"])


async def _seen_again(
    db: AsyncSession,
    report: BugReport,
    data: dict[str, Any],
    by: str,
    times: int = 1,
) -> None:
    """It happened again: count up, and a fixed bug comes back as new."""
    now = _now()
    await _add_count(db, report, times)
    report.last_seen = now
    if report.type == BUG and report.status == "fixed":
        _event(
            db,
            report,
            "status",
            "app",
            {
                "from": "fixed",
                "to": "new",
                "came_back": True,
                "fixed_in": report.fixed_in,
            },
        )
        report.status = "new"
        report.came_back_at = now
        report.needs_check = False
    _event(db, report, "seen", by, data)
    await db.flush()
    await _prune_seen(db, report.id)


# --------------------------------------------------------------------------- #
# Reading
# --------------------------------------------------------------------------- #


async def get(db: AsyncSession, report_id: uuid.UUID) -> BugReport:
    """A report that isn't merged away, or LookupError."""
    report = await db.get(BugReport, report_id)
    if report is None or report.merged_into_id is not None:
        raise LookupError("No such report.")
    return report


def _priority():
    rank = case(
        (BugReport.severity == "blocker", 3),
        (BugReport.severity == "major", 2),
        (BugReport.severity == "minor", 1),
        else_=0,
    )
    came_back = case((BugReport.came_back_at.is_(None), 0), else_=1)
    return (
        BugReport.pinned.desc(),
        rank.desc(),
        came_back.desc(),
        BugReport.count.desc(),
        BugReport.last_seen.desc(),
    )


def _row(r: BugReport, has_shot: bool = False) -> dict[str, Any]:
    """A list row: everything but the history, so a whole filtered list can
    be copied for Claude without opening each report."""
    return {
        "id": str(r.id),
        "type": r.type,
        "title": r.title,
        "section": r.section,
        "severity": r.severity,
        "status": r.status,
        "source": r.source,
        "count": r.count,
        "first_seen": _iso(r.first_seen),
        "last_seen": _iso(r.last_seen),
        "came_back_at": _iso(r.came_back_at),
        "needs_check": bool(r.needs_check),
        "fixed_in": r.fixed_in,
        "pinned": bool(r.pinned),
        "place": r.place,
        "has_shot": has_shot,
        "kind": r.kind,
        "box": r.box,
        "steps": list(r.steps or []),
        "actual": r.actual,
        "expected": r.expected,
        "confidence": r.confidence,
        "context": dict(r.context or {}),
        "run_id": str(r.run_id) if r.run_id else None,
    }


def event_out(e: BugReportEvent) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "kind": e.kind,
        "by": e.actor,
        "at": _iso(e.at),
        "data": dict(e.data or {}),
    }


async def _merged_family(
    db: AsyncSession, roots: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Each report and every report merged into it (up to ``MERGE_HOPS``
    deep), mapped to the root it now shows under."""
    family = {rid: rid for rid in roots}
    frontier = list(roots)
    for _ in range(MERGE_HOPS):
        if not frontier:
            break
        children = (
            await db.execute(
                select(BugReport.id, BugReport.merged_into_id).where(
                    BugReport.merged_into_id.in_(frontier)
                )
            )
        ).all()
        frontier = []
        for child, parent in children:
            if child not in family:
                family[child] = family[parent]
                frontier.append(child)
    return family


async def _with_shots(db: AsyncSession, roots: list[uuid.UUID]) -> set[uuid.UUID]:
    """Which of these reports have a screenshot, their own or one of a
    report merged into them (however deep)."""
    if not roots:
        return set()
    family = await _merged_family(db, roots)
    owners = await db.scalars(
        select(BugReportShot.report_id)
        .where(BugReportShot.report_id.in_(list(family)))
        .distinct()
    )
    return {family[o] for o in owners}


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_reports(
    db: AsyncSession,
    *,
    type: str = BUG,
    section: str | None = None,
    severity: str | None = None,
    source: str | None = None,
    status: str | None = None,
    came_back: bool | None = None,
    needs_check: bool | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """One tab of the inbox, highest priority first, with its counts. The
    section counts follow every filter but the section, so a chip shows what
    tapping it would."""
    if type not in TYPES:
        raise ValueError("type must be bug or idea")
    status = status or "open"
    conds = [BugReport.merged_into_id.is_(None), BugReport.type == type]
    if status == "open":
        conds.append(BugReport.status.in_(open_statuses(type)))
    elif status != "all":
        if status not in statuses_for(type):
            raise ValueError(f"Unknown status for {type}s: {status}")
        conds.append(BugReport.status == status)
    if severity:
        conds.append(BugReport.severity == severity)
    if source:
        conds.append(BugReport.source == source)
    if came_back is not None:
        conds.append(
            BugReport.came_back_at.is_not(None)
            if came_back
            else BugReport.came_back_at.is_(None)
        )
    if needs_check is not None:
        conds.append(BugReport.needs_check.is_(bool(needs_check)))
    text = (q or "").strip()[:100]
    if text:
        like = f"%{_escape_like(text.lower())}%"
        conds.append(
            or_(
                *[
                    func.lower(col).like(like, escape="\\")
                    for col in (
                        BugReport.title,
                        BugReport.place,
                        BugReport.box,
                        BugReport.actual,
                    )
                ]
            )
        )

    by_section = dict(
        (
            await db.execute(
                select(BugReport.section, func.count())
                .where(*conds)
                .group_by(BugReport.section)
            )
        ).all()
    )
    if section:
        conds.append(BugReport.section == section)
    total = await db.scalar(select(func.count()).select_from(BugReport).where(*conds))
    rows = (
        await db.scalars(
            select(BugReport)
            .where(*conds)
            .order_by(*_priority())
            .limit(min(max(limit, 1), LIST_MAX))
            .offset(max(offset, 0))
        )
    ).all()
    with_shots = await _with_shots(db, [r.id for r in rows])
    return {
        "items": [_row(r, r.id in with_shots) for r in rows],
        "total": total or 0,
        "counts": {
            "bugs_open": await _open_count(db, BUG),
            "ideas_open": await _open_count(db, IDEA),
            "sections": {s: int(by_section.get(s, 0)) for s in SECTIONS},
        },
    }


async def _open_count(db: AsyncSession, kind: str) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(BugReport)
            .where(
                BugReport.merged_into_id.is_(None),
                BugReport.type == kind,
                BugReport.status.in_(open_statuses(kind)),
            )
        )
    ) or 0


async def count_new_bugs(db: AsyncSession) -> int:
    """New bugs (not ideas), for the Admin badge (FR-020)."""
    return (
        await db.scalar(
            select(func.count())
            .select_from(BugReport)
            .where(
                BugReport.merged_into_id.is_(None),
                BugReport.type == BUG,
                BugReport.status == "new",
            )
        )
    ) or 0


async def detail(
    db: AsyncSession, report_id: uuid.UUID, viewer_id: uuid.UUID | None = None
) -> dict[str, Any]:
    """Everything about one report: every field, its history (notes, times
    seen, changes; newest first), links, screenshots, run and job. ``own``
    says whether the run and job are the viewer's, so the app only links to
    pages they can open (another user's job is named, not linked)."""
    r = await get(db, report_id)
    events = (
        await db.scalars(
            select(BugReportEvent)
            .where(BugReportEvent.report_id == r.id)
            .order_by(BugReportEvent.at.desc())
            .limit(EVENTS_SHOWN)
        )
    ).all()
    other = (
        select(BugReportLink.b_id.label("other"))
        .where(BugReportLink.a_id == r.id)
        .union(
            select(BugReportLink.a_id.label("other")).where(BugReportLink.b_id == r.id)
        )
        .subquery()
    )
    links = (
        await db.execute(
            select(BugReport.id, BugReport.title, BugReport.type, BugReport.status)
            .join(other, other.c.other == BugReport.id)
            .where(BugReport.merged_into_id.is_(None))
            .order_by(BugReport.title)
        )
    ).all()
    # Reports merged into this one, however deep, bring their screenshots
    # (a split takes them back with it).
    family = list(await _merged_family(db, [r.id]))
    shots = (
        await db.execute(
            select(BugReportShot.id, BugReportShot.size)
            .where(BugReportShot.report_id.in_(family))
            .order_by(BugReportShot.created_at)
        )
    ).all()
    job = None
    if r.job_id:
        found = (
            await db.execute(
                select(
                    SavedJob.id,
                    SavedJob.user_id,
                    SavedJob.custom_title,
                    SavedJob.custom_company,
                    JobListing.title,
                    JobListing.company,
                )
                .outerjoin(JobListing, JobListing.id == SavedJob.job_listing_id)
                .where(SavedJob.id == r.job_id)
            )
        ).first()
        if found:
            jid, uid, my_t, my_c, title, company = found
            job = {
                "id": str(jid),
                "title": my_t or title or "",
                "company": my_c or company or "",
                "own": viewer_id is not None and uid == viewer_id,
            }
    run = None
    if r.run_id:
        run_user = await db.scalar(
            select(ApplyRun.user_id).where(ApplyRun.id == r.run_id)
        )
        run = {
            "id": str(r.run_id),
            "own": viewer_id is not None and run_user == viewer_id,
        }
    return {
        **_row(r, bool(shots)),
        "run": run,
        "job": job,
        "events": [event_out(e) for e in events],
        "links": [
            {"id": str(i), "title": t, "type": ty, "status": s} for i, t, ty, s in links
        ],
        "shots": [{"id": str(i), "size": size} for i, size in shots],
    }


# --------------------------------------------------------------------------- #
# Adding
# --------------------------------------------------------------------------- #


async def create(
    db: AsyncSession, data: dict[str, Any], *, source: str = "owner"
) -> BugReport:
    """A report the owner (or their AI) wrote. Bugs default to major; ideas
    have no severity."""
    kind = data.get("type") or BUG
    if kind not in TYPES:
        raise ValueError("type must be bug or idea")
    section = data.get("section") or "other"
    if section not in SECTIONS:
        raise ValueError("Unknown section.")
    title = _clean("title", data.get("title"))
    if not title:
        raise ValueError("Give it a title.")
    severity = None
    if kind == BUG:
        severity = data.get("severity") or "major"
        if severity not in SEVERITIES:
            raise ValueError("severity must be blocker, major or minor")
    confidence = data.get("confidence") or "sure"
    if confidence not in CONFIDENCE:
        raise ValueError("confidence must be sure or not_sure")
    now = _now()
    report = BugReport(
        id=uuid.uuid4(),
        type=kind,
        title=title,
        section=section,
        kind=scrub(data.get("kind") or "manual", 40),
        place=_clean("place", data.get("place")),
        box=_clean("box", data.get("box")),
        steps=_clean("steps", data.get("steps")),
        actual=_clean("actual", data.get("actual")),
        expected=_clean("expected", data.get("expected")) if kind == BUG else "",
        severity=severity,
        confidence=confidence,
        source=source,
        status="new",
        count=1,
        first_seen=now,
        last_seen=now,
        context=clean_context(data.get("context")),
    )
    db.add(report)
    await db.flush()
    return report


async def from_run_problem(
    db: AsyncSession, run: ApplyRun, problem: dict[str, Any]
) -> BugReport:
    """A problem Claude reported during an Apply with Claude run (spec 030)
    is a report too (research R10): section Job Catcher for its Job Catcher
    and résumé kinds, Apply with Claude otherwise, linked to the run and the
    job. The same one again, in any run, counts up."""
    kind = problem.get("kind") or "other"
    section = "job_catcher" if kind in ("job_catcher", "resume") else "apply"
    text = scrub(problem.get("what"))
    site = problem.get("site") or host_of(problem.get("page"))
    fp = run_fingerprint(section, kind, site, text)
    context = clean_context(
        {"job_catcher": problem.get("job_catcher"), "playbook": problem.get("playbook")}
    )
    place = clean_place(problem.get("page")) or site
    seen = {"place": place, "context": context, "run_id": str(run.id)}

    found = await _by_fingerprint(db, fp)
    if found is None:
        now = _now()
        report = BugReport(
            id=uuid.uuid4(),
            type=BUG,
            title=scrub(text, TITLE_MAX),
            section=section,
            kind=kind,
            place=place,
            steps=[],
            actual=text,
            expected="",
            severity="major",
            confidence="sure",
            source="run",
            status="new",
            fingerprint=fp,
            count=1,
            first_seen=now,
            last_seen=now,
            context=context,
            run_id=run.id,
            job_id=run.saved_job_id,
        )
        try:
            # The fingerprint is unique: if the same problem was added at
            # the same moment, this one counts that one up instead.
            async with db.begin_nested():
                db.add(report)
                await db.flush()
        except IntegrityError:
            found = await _by_fingerprint(db, fp)
            if found is None:
                raise
        else:
            _event(db, report, "seen", "claude", seen)
            await db.flush()
            return report

    found.run_id = run.id
    found.job_id = run.saved_job_id
    if place:
        found.place = place
    found.context = {**(found.context or {}), **context}
    await _seen_again(db, found, seen, "claude")
    return found


async def _by_fingerprint(db: AsyncSession, fp: str) -> BugReport | None:
    """The report with this fingerprint, or the one it was merged into."""
    found = await db.scalar(select(BugReport).where(BugReport.fingerprint == fp))
    for _ in range(MERGE_HOPS):
        if found is None or found.merged_into_id is None:
            break
        found = await db.get(BugReport, found.merged_into_id)
    return found


# --------------------------------------------------------------------------- #
# Changing
# --------------------------------------------------------------------------- #


def _set_status(
    db: AsyncSession,
    r: BugReport,
    to: str,
    by: str,
    fixed_in: str | None = None,
) -> bool:
    if to not in statuses_for(r.type):
        raise ValueError(f"Unknown status for {r.type}s: {to}")
    if to == r.status and not (to == "fixed" and fixed_in and fixed_in != r.fixed_in):
        return False
    data: dict[str, Any] = {"from": r.status, "to": to}
    if to == "fixed":
        if fixed_in:
            r.fixed_in = fixed_in
            data["fixed_in"] = fixed_in
        # Claude's fix waits for the owner's look (FR-010).
        r.needs_check = by == "claude"
    else:
        r.needs_check = False
    if to in ("fixed", "wont_fix"):
        r.came_back_at = None
    r.status = to
    _event(db, r, "status", by, data)
    return True


async def update_report(
    db: AsyncSession,
    report_id: uuid.UUID,
    changes: dict[str, Any],
    by: str = "owner",
) -> BugReport:
    """Change any field. Each change is kept in the history. Turning a bug
    into an idea makes it a new idea with no severity; an idea into a bug, a
    new major bug."""
    r = await get(db, report_id)
    changes = {k: v for k, v in changes.items() if v is not None or k == "fixed_in"}

    new_type = changes.pop("type", None)
    if new_type and new_type != r.type:
        if new_type not in TYPES:
            raise ValueError("type must be bug or idea")
        _event(db, r, "edit", by, {"field": "type", "from": r.type, "to": new_type})
        old = r.status
        r.type = new_type
        r.status = "new"
        r.needs_check = False
        r.came_back_at = None
        r.severity = "major" if new_type == BUG else None
        if new_type == IDEA:
            r.expected = r.expected or ""
        if old != "new":
            _event(db, r, "status", by, {"from": old, "to": "new"})

    for field in ("section", "severity", "confidence"):
        if field not in changes:
            continue
        value = changes.pop(field)
        allowed = {
            "section": SECTIONS,
            "severity": SEVERITIES,
            "confidence": CONFIDENCE,
        }
        if value not in allowed[field]:
            raise ValueError(f"Unknown {field}.")
        if field == "severity" and r.type == IDEA:
            continue
        if getattr(r, field) != value:
            _event(
                db,
                r,
                "edit",
                by,
                {"field": field, "from": getattr(r, field), "to": value},
            )
            setattr(r, field, value)

    status = changes.pop("status", None)
    fixed_in = (
        _clean("fixed_in", changes.pop("fixed_in", None))
        if "fixed_in" in changes
        else None
    )
    if status:
        _set_status(db, r, status, by, fixed_in)
    elif fixed_in and fixed_in != r.fixed_in:
        _event(
            db, r, "edit", by, {"field": "fixed_in", "from": r.fixed_in, "to": fixed_in}
        )
        r.fixed_in = fixed_in

    if changes.pop("checked", None) and r.needs_check:
        r.needs_check = False
        _event(db, r, "edit", by, {"field": "checked", "from": False, "to": True})

    if "pinned" in changes:
        pinned = bool(changes.pop("pinned"))
        if pinned != r.pinned:
            r.pinned = pinned
            _event(
                db, r, "edit", by, {"field": "pinned", "from": not pinned, "to": pinned}
            )

    for field in ("title", "place", "box", "steps", "actual", "expected"):
        if field not in changes:
            continue
        value = _clean(field, changes.pop(field))
        if field == "title" and not value:
            raise ValueError("Give it a title.")
        if value != getattr(r, field):
            _event(
                db,
                r,
                "edit",
                by,
                {"field": field, "from": getattr(r, field), "to": value},
            )
            setattr(r, field, value)

    r.updated_at = _now()
    await db.flush()
    return r


async def bulk(
    db: AsyncSession,
    ids: list[uuid.UUID],
    *,
    status: str | None = None,
    section: str | None = None,
    by: str = "owner",
) -> int:
    """Change several at once. A status that doesn't fit a report's type (an
    idea can't be "won't fix") leaves that one as it is."""
    if section is not None and section not in SECTIONS:
        raise ValueError("Unknown section.")
    if status is not None and status not in (*BUG_STATUSES, *IDEA_STATUSES):
        raise ValueError("Unknown status.")
    reports = (
        await db.scalars(
            select(BugReport).where(
                BugReport.id.in_(ids[:BULK_MAX]), BugReport.merged_into_id.is_(None)
            )
        )
    ).all()
    changed = 0
    for r in reports:
        did = False
        if status and status in statuses_for(r.type):
            did = _set_status(db, r, status, by)
        if section and section != r.section:
            _event(
                db,
                r,
                "edit",
                by,
                {"field": "section", "from": r.section, "to": section},
            )
            r.section = section
            did = True
        if did:
            r.updated_at = _now()
            changed += 1
    await db.flush()
    return changed


async def delete_report(db: AsyncSession, report_id: uuid.UUID) -> None:
    """For good: its events, links and screenshots go with it, and anything
    merged into it comes back as its own report. A report merged away isn't
    there to delete (split it back first), so its count never lingers."""
    r = await get(db, report_id)
    await db.execute(
        update(BugReport)
        .where(BugReport.merged_into_id == r.id)
        .values(merged_into_id=None)
        .execution_options(synchronize_session=False)
    )
    for model, col in (
        (BugReportEvent, BugReportEvent.report_id),
        (BugReportShot, BugReportShot.report_id),
    ):
        await db.execute(delete(model).where(col == r.id))
    await db.execute(
        delete(BugReportLink).where(
            or_(BugReportLink.a_id == r.id, BugReportLink.b_id == r.id)
        )
    )
    await db.delete(r)
    await db.flush()


async def add_note(
    db: AsyncSession, report_id: uuid.UUID, text: str, by: str = "owner"
) -> BugReportEvent:
    r = await get(db, report_id)
    note = scrub(text, NOTE_MAX, lines=True)
    if not note:
        raise ValueError("Write the note.")
    ev = _event(db, r, "note", by, {"text": note})
    await db.flush()
    return ev


def _pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


async def link(
    db: AsyncSession, report_id: uuid.UUID, other_id: uuid.UUID, by: str = "owner"
) -> bool:
    """Related to, both ways. False when they were linked already."""
    if report_id == other_id:
        raise ValueError("A report can't be linked to itself.")
    r, other = await get(db, report_id), await get(db, other_id)
    a, b = _pair(r.id, other.id)
    if await db.get(BugReportLink, (a, b)) is not None:
        return False
    db.add(BugReportLink(a_id=a, b_id=b, created_at=_now()))
    _event(db, r, "link", by, {"other_id": str(other.id), "title": other.title})
    _event(db, other, "link", by, {"other_id": str(r.id), "title": r.title})
    await db.flush()
    return True


async def unlink(
    db: AsyncSession, report_id: uuid.UUID, other_id: uuid.UUID, by: str = "owner"
) -> None:
    a, b = _pair(report_id, other_id)
    found = await db.get(BugReportLink, (a, b))
    if found is None:
        raise LookupError("They aren't linked.")
    await db.delete(found)
    for one, two in ((report_id, other_id), (other_id, report_id)):
        r = await db.get(BugReport, one)
        if r is not None:
            _event(db, r, "unlink", by, {"other_id": str(two)})
    await db.flush()


def _when(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return _aware(datetime.fromisoformat(str(value)))
    except ValueError:
        return None


def _dates(r: BugReport) -> dict[str, str | None]:
    return {
        "first_seen": _iso(r.first_seen),
        "last_seen": _iso(r.last_seen),
        "came_back_at": _iso(r.came_back_at),
    }


async def merge(
    db: AsyncSession, report_id: uuid.UUID, into_id: uuid.UUID, by: str = "owner"
) -> BugReport:
    """The same problem: ``report_id`` goes into ``into_id``, its count added,
    and is hidden until split back. Its own text and history are kept. The
    event keeps both reports' dates, so a split can work them out again."""
    if report_id == into_id:
        raise ValueError("A report can't be merged into itself.")
    try:
        src, dst = await get(db, report_id), await get(db, into_id)
    except LookupError as exc:
        raise ValueError("That report is gone or already merged.") from exc
    data = {
        "other_id": str(src.id),
        "title": src.title,
        "snapshot": {"count": src.count, **_dates(src)},
        "into": _dates(dst),
    }
    await _add_count(db, dst, src.count or 0)
    dst.first_seen = min(_aware(dst.first_seen), _aware(src.first_seen))
    dst.last_seen = max(_aware(dst.last_seen), _aware(src.last_seen))
    if dst.type == BUG and src.came_back_at and not dst.came_back_at:
        dst.came_back_at = src.came_back_at
    src.merged_into_id = dst.id
    _event(db, dst, "merge", by, data)
    await db.flush()
    return dst


async def split(
    db: AsyncSession, report_id: uuid.UUID, event_id: uuid.UUID, by: str = "owner"
) -> BugReport:
    """Undo a merge: the merged report is its own again, its count taken back,
    and the dates worked out from the report's own and what's still merged
    into it (another merge may still be there)."""
    dst = await get(db, report_id)
    ev = await db.get(BugReportEvent, event_id)
    if ev is None or ev.report_id != dst.id or ev.kind != "merge":
        raise LookupError("No such merge.")
    data = dict(ev.data or {})
    if data.get("split"):
        raise ValueError("That merge was undone already.")
    src = await db.get(BugReport, uuid.UUID(data["other_id"]))
    if src is None or src.merged_into_id != dst.id:
        raise ValueError("That report isn't merged here any more.")
    snap = data.get("snapshot") or {}
    src.merged_into_id = None
    ev.data = {**data, "split": True}
    await db.flush()

    taken = int(snap.get("count") or 0)
    await db.execute(
        update(BugReport)
        .where(BugReport.id == dst.id)
        .values(
            count=case((BugReport.count - taken < 1, 1), else_=BugReport.count - taken)
        )
        .execution_options(synchronize_session=False)
    )
    await db.refresh(dst, ["count"])

    # The report's own dates: as they were at its first merge.
    first_merge = await db.scalar(
        select(BugReportEvent)
        .where(BugReportEvent.report_id == dst.id, BugReportEvent.kind == "merge")
        .order_by(BugReportEvent.at)
        .limit(1)
    )
    own = (first_merge.data or {}).get("into", {}) if first_merge else {}
    still = (
        await db.scalars(select(BugReport).where(BugReport.merged_into_id == dst.id))
    ).all()
    last_own_seen = await db.scalar(
        select(func.max(BugReportEvent.at)).where(
            BugReportEvent.report_id == dst.id, BugReportEvent.kind == "seen"
        )
    )
    firsts = [_when(own.get("first_seen")), *[_aware(r.first_seen) for r in still]]
    lasts = [
        _when(own.get("last_seen")),
        _aware(last_own_seen),
        *[_aware(r.last_seen) for r in still],
    ]
    dst.first_seen = min(d for d in firsts if d) if any(firsts) else dst.first_seen
    dst.last_seen = max(d for d in lasts if d) if any(lasts) else dst.last_seen
    # "Came back" that only came with this merge goes with it; one the report
    # earned itself since (a later date) stays.
    copied = _when(snap.get("came_back_at"))
    if copied and _aware(dst.came_back_at) == copied:
        backs = [
            _when(own.get("came_back_at")),
            *[_aware(r.came_back_at) for r in still],
        ]
        dst.came_back_at = max((d for d in backs if d), default=None)
    _event(db, dst, "split", by, {"other_id": str(src.id), "title": src.title})
    await db.flush()
    return src


# --------------------------------------------------------------------------- #
# Screenshots (research R1)
# --------------------------------------------------------------------------- #

SHOT_MAX_BYTES = 1_000_000
SHOTS_MAX = 3
SHOT_TYPES = ("image/jpeg", "image/png", "image/webp")


class TooManyShots(Exception):
    """A report already has its 3 screenshots."""


class NotAPicture(Exception):
    """Not a JPEG, PNG or WebP, by its first bytes."""


def image_type(data: bytes) -> str | None:
    """What the first bytes say the picture is, whatever it claims to be."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def add_shot(
    db: AsyncSession, report_id: uuid.UUID, mime: str, data: bytes
) -> BugReportShot:
    """One screenshot on a report: a JPEG, PNG or WebP (by its bytes, and
    matching the type it was sent as), at most 1 MB, at most 3 a report."""
    r = await get(db, report_id)
    if len(data) > SHOT_MAX_BYTES:
        raise ValueError("A screenshot must be under 1 MB.")
    if mime not in SHOT_TYPES or image_type(data) != mime:
        raise NotAPicture("Send a JPEG, PNG or WebP picture.")
    have = await db.scalar(
        select(func.count())
        .select_from(BugReportShot)
        .where(BugReportShot.report_id == r.id)
    )
    if (have or 0) >= SHOTS_MAX:
        raise TooManyShots(f"A report can have {SHOTS_MAX} screenshots.")
    shot = BugReportShot(
        id=uuid.uuid4(),
        report_id=r.id,
        mime=mime,
        size=len(data),
        data=data,
        created_at=_now(),
    )
    db.add(shot)
    await db.flush()
    return shot


async def shot_bytes(db: AsyncSession, shot_id: uuid.UUID) -> tuple[str, bytes]:
    """A screenshot's type and bytes, or LookupError."""
    found = (
        await db.execute(
            select(BugReportShot.mime, BugReportShot.data).where(
                BugReportShot.id == shot_id
            )
        )
    ).first()
    if found is None:
        raise LookupError("No such screenshot.")
    return found[0], found[1]


async def delete_shot(db: AsyncSession, shot_id: uuid.UUID) -> None:
    found = await db.scalar(select(BugReportShot.id).where(BugReportShot.id == shot_id))
    if found is None:
        raise LookupError("No such screenshot.")
    await db.execute(delete(BugReportShot).where(BugReportShot.id == shot_id))
    await db.flush()


# --------------------------------------------------------------------------- #
# Repeat suggestions (research R3)
# --------------------------------------------------------------------------- #

SIMILAR_SCORE = 80
SIMILAR_MAX = 3
# How many open reports of a section are compared (the newest).
SIMILAR_POOL = 500


async def similar(db: AsyncSession, report: BugReport) -> list[dict[str, Any]]:
    """Up to 3 open reports of the same type and section whose titles are
    close to this one's (token set ratio of 80 or more), closest first. Only
    suggested: the owner says whether it's the same problem."""
    rows = (
        await db.execute(
            select(BugReport.id, BugReport.title, BugReport.status)
            .where(
                BugReport.id != report.id,
                BugReport.merged_into_id.is_(None),
                BugReport.type == report.type,
                BugReport.section == report.section,
                BugReport.status.in_(open_statuses(report.type)),
            )
            .order_by(BugReport.last_seen.desc())
            .limit(SIMILAR_POOL)
        )
    ).all()
    scored = []
    for rid, title, status in rows:
        score = fuzz.token_set_ratio(
            report.title, title, processor=utils.default_process
        )
        if score >= SIMILAR_SCORE:
            scored.append(
                {
                    "id": str(rid),
                    "title": title,
                    "status": status,
                    "score": round(score),
                }
            )
    scored.sort(key=lambda s: -s["score"])
    return scored[:SIMILAR_MAX]


# --------------------------------------------------------------------------- #
# Caught errors (research R6)
# --------------------------------------------------------------------------- #

CAUGHT_MESSAGE_MAX = 300
# The part of an error's own words kept with it: the start of its first line
# (a database error's next lines hold the query and its values).
ERROR_TEXT_MAX = 120
FLOOD_KIND = "too_many"
_KEY_MAX = 80
# What the server notices itself. Everything else was sent in by the app or
# Job Catcher (``/v1/bugs/caught``), which anyone signed in can do, so it has
# caps of its own: a flood of those never pushes the server's own errors out.
SERVER_KINDS = ("server_error", "email_check", "scout_refused", "service_down")
SERVER_PER_HOUR = 30
SENT_PER_HOUR = 20
SENT_PER_SENDER_HOUR = 5
# Per sender (a hash of who, kept in memory only, never stored): when each of
# their last new reports was made.
_sent_new: dict[str, list[float]] = {}
_URL = re.compile(r"\bhttps?://[^\s'\"<>()\[\]{}]+", re.I)
_TITLES = {
    "server_error": "Server error on {place}",
    "crash": "The app crashed on {place}",
    "save_failed": "Job Catcher couldn't save on {place}",
    "resume_failed": "Job Catcher couldn't attach the résumé on {place}",
    "fill_failed": "Job Catcher couldn't fill on {place}",
    "email_check": "Email check failed: {place}",
    "scout_refused": "Scout turned down a {place} call",
    "service_down": "{place} is down",
}
# Kinds whose place already says which one it is: no words in the title.
_PLAIN_TITLES = ("server_error", "service_down", "email_check")
# The section a server error belongs to, by its route.
_ROUTE_SECTIONS = (
    ("/v1/apply", "apply"),
    ("/v1/email", "email"),
    ("/v1/scout", "scout"),
    ("/v1/extension", "job_catcher"),
)


def _sessions() -> async_sessionmaker:
    """Where caught server errors are written: a short session of their own
    (the request's may be the one that broke). Tests point it elsewhere."""
    from app.database import AsyncSessionLocal

    return AsyncSessionLocal


def clean_urls(text: Any) -> str:
    """Every web address in a text as its site and path only: no query or
    fragment (where searches, tokens and names live), ids as ``:id``."""
    return _URL.sub(
        lambda m: clean_place(m.group(0).rstrip(".,;:!?")) or "[link]",
        str(text or ""),
    )


def caught_key(text: Any) -> str:
    """What tells two errors on one page apart: their words, with numbers as
    N, so "row 12" and "row 13" are the same problem."""
    words = scrub(clean_urls(text), _KEY_MAX * 2)
    return re.sub(r"\d+", "N", words)[:_KEY_MAX].lower()


def _caught_place(place: Any) -> str:
    where = clean_place(place)
    if where:
        return where
    # Not an address (a provider, a tool, a service): plain words.
    return scrub(place, PLACE_MAX) or "unknown"


def caught_fingerprint(
    section: str, kind: str, place: Any, key: str | None = None
) -> str:
    return fingerprint(section, kind, f"{_caught_place(place)}|{key or ''}")


def error_text(exc: BaseException) -> str:
    """An exception as its class and the start of its first line, scrubbed,
    with any web address as its site and path only."""
    lines = (str(exc) or "").strip().splitlines()
    words = scrub(clean_urls(lines[0]) if lines else "", ERROR_TEXT_MAX)
    name = type(exc).__name__
    return f"{name}: {words}" if words else name


def _sender_key(sender: str) -> str:
    return hashlib.sha256(str(sender).encode()).hexdigest()[:16]


def _sender_recent(sender: str) -> list[float]:
    """This sender's new reports in the last hour (and forget older ones)."""
    now = time.monotonic()
    for key in [k for k, v in _sent_new.items() if not v or now - v[-1] > 3600]:
        _sent_new.pop(key, None)
    times = [t for t in _sent_new.get(_sender_key(sender), []) if now - t <= 3600]
    _sent_new[_sender_key(sender)] = times
    return times


async def _caught_this_hour(db: AsyncSession, sent: bool) -> int:
    """New caught reports in the last hour: the server's own, or the ones
    the app and Job Catcher sent in."""
    since = _now() - timedelta(hours=1)
    group = (
        BugReport.kind.not_in((*SERVER_KINDS, FLOOD_KIND))
        if sent
        else BugReport.kind.in_(SERVER_KINDS)
    )
    return (
        await db.scalar(
            select(func.count())
            .select_from(BugReport)
            .where(
                BugReport.source == "caught",
                group,
                BugReport.first_seen >= since,
            )
        )
    ) or 0


async def _add_new_or_count(
    db: AsyncSession, fp: str, build: Callable[[], BugReport], seen: dict
) -> BugReport:
    """Add the report ``build`` makes, or, when one with its fingerprint was
    added at the same moment, count that one up instead."""
    report = build()
    try:
        async with db.begin_nested():
            db.add(report)
            await db.flush()
    except IntegrityError:
        found = await _by_fingerprint(db, fp)
        if found is None:
            raise
        await _seen_again(db, found, seen, "app")
        return found
    _event(db, report, "seen", "app", seen)
    await db.flush()
    return report


def _flood_title(sent: bool, n: int, hour: datetime) -> str:
    who = " sent by the app and Job Catcher" if sent else ""
    return (
        f"Too many errors{who}: {n} more not kept between "
        f"{hour:%H}:00 and {(hour + timedelta(hours=1)):%H}:00 UTC"
    )


async def _flood(db: AsyncSession, sent: bool) -> None:
    """Past an hourly cap: one report counts the errors not kept, its title
    saying how many in this hour. If the owner merged it into another report,
    that one counts them, and keeps its own title."""
    fp = fingerprint("app", FLOOD_KIND, "sent" if sent else "caught")
    now = _now()
    hour = now.replace(minute=0, second=0, microsecond=0)
    found = await _by_fingerprint(db, fp)
    if found is not None:
        last = await db.scalar(
            select(BugReportEvent)
            .where(
                BugReportEvent.report_id == found.id,
                BugReportEvent.kind == "seen",
            )
            .order_by(BugReportEvent.at.desc())
            .limit(1)
        )
        data = (last.data or {}) if last is not None else {}
        n = (
            int(data.get("not_kept") or 0) + 1
            if data.get("hour") == hour.isoformat()
            else 1
        )
        await _seen_again(
            db, found, {"place": None, "hour": hour.isoformat(), "not_kept": n}, "app"
        )
        if found.kind == FLOOD_KIND:
            found.title = _flood_title(sent, n, hour)
        await db.flush()
        return
    cap = SENT_PER_HOUR if sent else SERVER_PER_HOUR

    def build() -> BugReport:
        return BugReport(
            id=uuid.uuid4(),
            type=BUG,
            title=_flood_title(sent, 1, hour),
            section="app",
            kind=FLOOD_KIND,
            place=None,
            steps=[],
            actual=(
                f"More than {cap} new errors"
                + (" were sent by the app and Job Catcher" if sent else " were caught")
                + " in an hour. The ones past that weren't kept; this report "
                "counts them."
            ),
            expected="",
            severity="major",
            confidence="sure",
            source="caught",
            status="new",
            fingerprint=fp,
            count=1,
            first_seen=now,
            last_seen=now,
            context={"api_version": api_version()},
        )

    await _add_new_or_count(
        db, fp, build, {"place": None, "hour": hour.isoformat(), "not_kept": 1}
    )


async def catch(
    db: AsyncSession,
    *,
    section: str,
    kind: str,
    place: Any,
    message: Any = "",
    context: dict[str, Any] | None = None,
    key: str | None = None,
    sender: str | None = None,
) -> bool:
    """Keep an error the app caught itself. Never who hit it: where, what
    kind, the error's scrubbed words (web addresses as site and path only)
    and the versions. The same one again (section, kind, place and ``key``)
    counts up, and a fixed one comes back. New ones are capped an hour: 30
    the server noticed itself, and, for ones the app or Job Catcher sent in
    (``sender``: who sent it, only ever held in memory as a hash), 20 in all
    and 5 from any one person. Past a cap only a "too many" report counts
    them. True when it was kept."""
    section = section if section in SECTIONS else "other"
    kind = re.sub(r"[^a-z_]", "", str(kind or "").lower())[:40] or "other"
    sent = sender is not None or kind not in SERVER_KINDS
    where = _caught_place(place)
    text = scrub(clean_urls(message), CAUGHT_MESSAGE_MAX, lines=True)
    ctx = clean_context({**(context or {}), "api_version": api_version()})
    fp = caught_fingerprint(section, kind, place, key)
    seen = {"place": where, "context": ctx, "message": text}

    found = await _by_fingerprint(db, fp)
    if found is not None:
        # Repeats always count, cap or not.
        await _seen_again(db, found, seen, "app")
        return True
    mine = _sender_recent(sender) if sender is not None else []
    if (
        await _caught_this_hour(db, sent)
        >= (SENT_PER_HOUR if sent else SERVER_PER_HOUR)
    ) or len(mine) >= SENT_PER_SENDER_HOUR:
        await _flood(db, sent)
        return False
    title = _TITLES.get(kind, "Error on {place}").format(place=where)
    if kind not in _PLAIN_TITLES and text:
        # Two errors on one page are told apart by their words.
        title = f"{title}: {text.splitlines()[0]}"
    now = _now()

    def build() -> BugReport:
        return BugReport(
            id=uuid.uuid4(),
            type=BUG,
            title=scrub(title, TITLE_MAX),
            section=section,
            kind=kind,
            place=where,
            steps=[],
            actual=text,
            expected="",
            severity="major",
            confidence="sure",
            source="caught",
            status="new",
            fingerprint=fp,
            count=1,
            first_seen=now,
            last_seen=now,
            context=ctx,
        )

    await _add_new_or_count(db, fp, build, seen)
    if sender is not None:
        mine.append(time.monotonic())
    return True


async def catch_safely(db: AsyncSession, **kwargs: Any) -> bool:
    """``catch`` inside its own savepoint, so it can't spoil the caller's
    work, and never raising: a failure here is only logged, never caught
    again (no loops)."""
    try:
        async with db.begin_nested():
            return await catch(db, **kwargs)
    except Exception:  # noqa: BLE001 — keeping an error must never add one
        logger.warning("Couldn't keep a caught error", exc_info=True)
        return False


def section_for_route(path: str) -> str:
    for prefix, section in _ROUTE_SECTIONS:
        if path == prefix or path.startswith(prefix + "/"):
            return section
    return "app"


async def catch_server_error(request: Any, exc: BaseException) -> None:
    """An unexpected server error, kept in a short session of its own: the
    method and route template (never the ids in the address), the
    exception's class and the start of its words. Never raises."""
    try:
        route = request.scope.get("route")
        template = getattr(route, "path", None) or request.url.path
        async with asyncio.timeout(3):
            async with _sessions()() as db:
                await catch(
                    db,
                    section=section_for_route(template),
                    kind="server_error",
                    place=f"{request.method} {template}",
                    message=error_text(exc),
                    key=type(exc).__name__,
                )
                await db.commit()
    except Exception:  # noqa: BLE001 — never report the reporting
        logger.warning("Couldn't keep a server error", exc_info=True)


# --------------------------------------------------------------------------- #
# Services going down (the 15-minute health watch)
# --------------------------------------------------------------------------- #


def _recovered(e: BugReportEvent) -> bool:
    return e.kind == "edit" and (e.data or {}).get("field") == "recovered"


async def _outage_report(db: AsyncSession, name: str) -> BugReport | None:
    return await _by_fingerprint(db, caught_fingerprint("app", "service_down", name))


async def outage_open(db: AsyncSession, name: str) -> bool:
    """Is this service's outage still going? Its report was last seen down
    and hasn't been marked back up since."""
    report = await _outage_report(db, name)
    if report is None:
        return False
    recent = (
        await db.scalars(
            select(BugReportEvent)
            .where(
                BugReportEvent.report_id == report.id,
                BugReportEvent.kind.in_(("seen", "edit")),
            )
            .order_by(BugReportEvent.at.desc())
            .limit(50)
        )
    ).all()
    for e in recent:
        if e.kind == "seen":
            return True
        if _recovered(e):
            return False
    return False


async def service_down(db: AsyncSession, name: str, detail: str | None) -> bool:
    """A service turned down: one report per outage (a later outage counts
    the same report up, and brings a fixed one back)."""
    return await catch(
        db,
        section="app",
        kind="service_down",
        place=name,
        # The first line of what the check said, short (never a whole
        # connection error).
        message=f"{name} is down"
        + (f": {scrub((detail or '').splitlines()[0], 80)}" if detail else ""),
    )


async def service_up(db: AsyncSession, name: str) -> None:
    """The service is back: a line in its report's history."""
    report = await _outage_report(db, name)
    if report is not None:
        _event(
            db,
            report,
            "edit",
            "app",
            {"field": "recovered", "from": "down", "to": "up"},
        )
        await db.flush()
