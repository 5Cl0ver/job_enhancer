"""Claude Scout's Results (spec 012): every job a run found, in one place,
grouped against each run's own bar and sorted best first.

Groups and statuses are worked out here, never stored, so the phone and the
computer show the same thing (research R7):

- **band**: best (at or over the run's bar), possible (up to 2 under), or
  long_shot.
- **status**: new (waiting on the user), saved, passed, or hidden (a repeat of
  a job already found or tracked, or too far away).
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.saved_job import SavedJob
from app.models.scout import (
    BELOW_BAR,
    DUPLICATE,
    NO_COPY,
    PICKED,
    RUN_QUEUED,
    SAVED,
    SKIPPED,
    TOO_FAR,
    WAITING,
    ScoutCapture,
    ScoutFinding,
    ScoutRun,
)
from app.services import scout_review as review

BANDS = ("best", "possible", "long_shot")
STATUSES = ("new", "saved", "passed", "hidden")
# How far under the bar still counts as Possible.
POSSIBLE_GAP = 2
NEW = (PICKED, BELOW_BAR, NO_COPY, WAITING)
# How many findings Results reads at most (a handful of users, hundreds each).
MAX_READ = 3000
MAX_LIMIT = 500


def band(fit: int, min_fit: int) -> str:
    if fit >= min_fit:
        return "best"
    if fit >= min_fit - POSSIBLE_GAP:
        return "possible"
    return "long_shot"


def status_of(outcome: str, saved_job_id: uuid.UUID | None) -> str:
    if outcome == SAVED or (outcome == DUPLICATE and saved_job_id is not None):
        return "saved"
    if outcome == SKIPPED:
        return "passed"
    if outcome in (DUPLICATE, TOO_FAR):
        return "hidden"
    return "new"


async def _copied(db: AsyncSession, user_id: uuid.UUID, keys: set[str]) -> set[str]:
    if not keys:
        return set()
    return set(
        await db.scalars(
            select(ScoutCapture.url_key)
            .where(ScoutCapture.user_id == user_id, ScoutCapture.url_key.in_(keys))
            .distinct()
        )
    )


async def last_run_id(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    """The latest run that has started (running or finished)."""
    return await db.scalar(
        select(ScoutRun.id)
        .where(ScoutRun.user_id == user_id, ScoutRun.status != RUN_QUEUED)
        .order_by(ScoutRun.created_at.desc())
        .limit(1)
    )


async def list_findings(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    run: str | None = None,
    track: uuid.UUID | None = None,
    status: str = "new",
    sort: str = "fit",
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """The user's findings for Results: one page of the chosen status, best
    first (or newest), with counts per group and per status. A job found by
    more than one run is listed once, as its latest finding."""
    if status not in STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    if sort not in ("fit", "newest"):
        raise HTTPException(status_code=422, detail="Unknown sort")
    limit = max(1, min(int(limit), MAX_LIMIT))
    offset = max(0, int(offset))
    query = (
        select(ScoutFinding, ScoutRun.criteria, SavedJob.job_listing_id)
        .join(ScoutRun, ScoutRun.id == ScoutFinding.run_id)
        .outerjoin(SavedJob, SavedJob.id == ScoutFinding.saved_job_id)
        .where(ScoutFinding.user_id == user_id)
        .order_by(ScoutFinding.created_at.desc())
        .limit(MAX_READ)
    )
    if run and run != "all":
        if run == "last":
            run_id = await last_run_id(db, user_id)
        else:
            try:
                run_id = uuid.UUID(run)
            except ValueError:
                raise HTTPException(status_code=422, detail="Unknown run") from None
        if run_id is None:
            return _page([], limit, offset, status, sort)
        query = query.where(ScoutFinding.run_id == run_id)
    if track is not None:
        query = query.where(ScoutFinding.track_id == track)
    rows = (await db.execute(query)).all()
    # One row per job: what the user did with it wins over a later repeat
    # (saved, then new, then passed, then hidden), then the newest.
    rank = {"saved": 0, "new": 1, "passed": 2, "hidden": 3}
    chosen: dict[str, tuple] = {}
    for finding, criteria, listing_id in rows:  # newest first
        mine = rank[status_of(finding.outcome, finding.saved_job_id)]
        had = chosen.get(finding.url_key)
        if had is None or mine < had[0]:
            chosen[finding.url_key] = (mine, finding, criteria or {}, listing_id)
    latest = [(f, c, lid) for _, f, c, lid in chosen.values()]
    latest.sort(key=lambda x: x[0].created_at, reverse=True)
    copied = await _copied(
        db, user_id, {f.url_key for f, *_ in latest if f.outcome in review.SAVEABLE}
    )
    items = [_item(f, c, listing_id, copied) for f, c, listing_id in latest]
    return _page(items, limit, offset, status, sort)


def _page(items: list[dict], limit: int, offset: int, status: str, sort: str) -> dict:
    counts = {k: 0 for k in (*BANDS, *STATUSES)}
    for item in items:
        counts[item["status"]] += 1
    chosen = [i for i in items if i["status"] == status]
    for item in chosen:
        counts[item["band"]] += 1
    if sort == "fit":
        # Newest first among equal scores (the list is newest first already).
        chosen.sort(key=lambda i: (BANDS.index(i["band"]), -i["fit"]))
    page = chosen[offset : offset + limit]
    more = offset + limit < len(chosen)
    return {"items": page, "counts": counts, "next": offset + limit if more else None}


def _item(f: ScoutFinding, c: dict, listing_id, copied: set[str]) -> dict:
    min_fit = int(c.get("min_fit", 6))
    return {
        "id": f.id,
        "run_id": f.run_id,
        "run_name": c.get("name", ""),
        "track_id": f.track_id,
        "source": f.source,
        "search_title": f.search_title,
        "title": f.title,
        "company": f.company,
        "location": f.location,
        "level": f.level,
        "years_asked": f.years_asked,
        "posted": f.posted,
        "url": f.url,
        "fit": f.fit_score,
        "claude_fit": f.claude_fit,
        "band": band(f.fit_score, min_fit),
        "min_fit": min_fit,
        "why_fit": f.why_fit,
        "gaps": f.gaps,
        "app_note": f.app_note,
        "status": status_of(f.outcome, f.saved_job_id),
        "outcome": f.outcome,
        "facts_from": f.facts_from,
        "can_save": f.outcome in review.SAVEABLE and f.url_key in copied,
        "can_save_anyway": f.url_key not in copied and review.can_save_anyway(f),
        "saved_job_id": f.saved_job_id,
        "job_listing_id": listing_id,
        "found_at": f.created_at,
    }


async def _finding(
    db: AsyncSession, user_id: uuid.UUID, finding_id: uuid.UUID
) -> tuple[ScoutFinding, ScoutRun]:
    row = (
        await db.execute(
            select(ScoutFinding, ScoutRun)
            .join(ScoutRun, ScoutRun.id == ScoutFinding.run_id)
            .where(ScoutFinding.id == finding_id, ScoutFinding.user_id == user_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="That job isn't in your searches")
    return row[0], row[1]


async def pass_finding(
    db: AsyncSession, user_id: uuid.UUID, finding_id: uuid.UUID
) -> dict:
    """The user passed on a new job: it leaves New and later runs skip it."""
    finding, run = await _finding(db, user_id, finding_id)
    if status_of(finding.outcome, finding.saved_job_id) != "new":
        raise HTTPException(status_code=409, detail="Only new jobs can be passed on")
    finding.outcome = SKIPPED
    finding.passed_at = datetime.now(UTC)
    await db.flush()
    return await _one(db, user_id, finding, run)


async def restore_finding(
    db: AsyncSession, user_id: uuid.UUID, finding_id: uuid.UUID
) -> dict:
    """Undo a pass: the job is new again, as a pick, under the bar, or not
    copied, as it was found."""
    finding, run = await _finding(db, user_id, finding_id)
    if finding.outcome != SKIPPED:
        raise HTTPException(status_code=409, detail="Only passed jobs can be restored")
    min_fit = int((run.criteria or {}).get("min_fit", 6))
    if not await _copied(db, user_id, {finding.url_key}):
        finding.outcome = NO_COPY
    else:
        finding.outcome = PICKED if finding.fit_score >= min_fit else BELOW_BAR
    finding.passed_at = None
    await db.flush()
    return await _one(db, user_id, finding, run)


async def _one(
    db: AsyncSession, user_id: uuid.UUID, finding: ScoutFinding, run: ScoutRun
) -> dict:
    listing_id = None
    if finding.saved_job_id is not None:
        listing_id = await db.scalar(
            select(SavedJob.job_listing_id).where(SavedJob.id == finding.saved_job_id)
        )
    copied = await _copied(db, user_id, {finding.url_key})
    return _item(finding, run.criteria or {}, listing_id, copied)
