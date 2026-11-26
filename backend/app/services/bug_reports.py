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
"""

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

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
    has_shot = (
        select(BugReportShot.id).where(BugReportShot.report_id == BugReport.id).exists()
    )
    rows = (
        await db.execute(
            select(BugReport, has_shot)
            .where(*conds)
            .order_by(*_priority())
            .limit(min(max(limit, 1), LIST_MAX))
            .offset(max(offset, 0))
        )
    ).all()
    return {
        "items": [_row(r, bool(shot)) for r, shot in rows],
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
    shots = (
        await db.execute(
            select(BugReportShot.id, BugReportShot.size)
            .where(BugReportShot.report_id == r.id)
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
