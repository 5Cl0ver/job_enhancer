"""Claude Scout's review step: Claude proposes, the user decides.

A job Claude scores at or above the search's bar is a **pick** that waits. The
user ticks what to keep, chooses a collection (pre-filled from the search) and
presses one button; only then is anything saved, word for word from the page
copy Job Catcher took. A search can opt out ("save without asking"), in which
case the same save happens the moment Claude reports the job.

Kept apart from ``scout_runs`` (which imports this) so the saving rules live in
one place for both paths.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.saved_job import ORIGIN_SCOUT
from app.models.scout import (
    BELOW_BAR,
    DUPLICATE,
    NO_COPY,
    PICKED,
    SAVED,
    SKIPPED,
    WAITING,
    ScoutCapture,
    ScoutFinding,
    ScoutRun,
)
from app.schemas.collection import CollectionCreate
from app.schemas.saved_job import ManualJobCreate
from app.schemas.scout import (
    ConfirmIn,
    ConfirmOut,
    FindingFailed,
    FindingSaved,
    RunFolder,
    SaveFindingIn,
    SaveFindingOut,
)
from app.services import collections as col_svc
from app.services import saved_jobs as sj_svc
from app.services.scout_dedupe import posting_link

SCOUT_FOLDER = "Scout"
SOURCE_LABEL = {
    "linkedin": "LinkedIn",
    "indeed": "Indeed",
    "ziprecruiter": "ZipRecruiter",
    "google_jobs": "Google Jobs",
    "local_companies": "Local companies",
}
# "Found by Claude Scout on …" for a search that isn't one site.
FOUND_ON = {"local_companies": "a local company's own site"}
# A finding the user can still put in My Jobs (given its page copy exists: one
# that arrived after Claude moved on counts too).
SAVEABLE = (PICKED, SKIPPED, BELOW_BAR, NO_COPY, WAITING)
NO_COPY_REASON = "The copy of this job's page is gone. Open the posting and save it."


# --------------------------------------------------------------------------- #
# Which collection
# --------------------------------------------------------------------------- #
async def find_folder(
    db: AsyncSession, user_id: uuid.UUID, name: str
) -> Collection | None:
    return await db.scalar(
        select(Collection)
        .where(
            Collection.user_id == user_id,
            func.lower(Collection.name) == name.strip().lower(),
        )
        .order_by(Collection.created_at)
        .limit(1)
    )


async def make_folder(db: AsyncSession, user_id: uuid.UUID, name: str) -> Collection:
    """The user's collection of this name, made if there isn't one."""
    name = " ".join(name.split())[:100]
    folder = await find_folder(db, user_id, name)
    if folder is not None:
        return folder
    try:
        async with db.begin_nested():  # another save may make it at the same time
            return await col_svc.create_collection(
                db, user_id, CollectionCreate(name=name)
            )
    except HTTPException:
        folder = await find_folder(db, user_id, name)
        if folder is None:
            raise
        return folder


BROAD_FOLDER = "Claude's picks"


def default_folder_name(criteria: dict) -> str:
    """A search with no collection chosen saves into one named after its resume
    type ("IT Admin"), so different kinds of role don't pile into one place. An
    "Anything I'd be good at" search saves into "Claude's picks"."""
    if (criteria or {}).get("broad"):
        return BROAD_FOLDER
    name = ((criteria or {}).get("track") or {}).get("name") or ""
    return " ".join(str(name).split())[:100] or SCOUT_FOLDER


async def _chosen(
    db: AsyncSession, user_id: uuid.UUID, criteria: dict
) -> Collection | None:
    """The collection picked on the search, if it still exists."""
    raw = (criteria or {}).get("collection_id")
    if not raw:
        return None
    try:
        collection_id = uuid.UUID(str(raw))
    except ValueError:
        return None
    return await db.scalar(
        select(Collection).where(
            Collection.id == collection_id, Collection.user_id == user_id
        )
    )


async def peek_folder(
    db: AsyncSession, user_id: uuid.UUID, criteria: dict
) -> RunFolder:
    """Where a run's jobs would go, without making anything. ``id`` is null
    while the default collection doesn't exist yet."""
    chosen = await _chosen(db, user_id, criteria)
    if chosen is not None:
        return RunFolder(id=chosen.id, name=chosen.name)
    name = default_folder_name(criteria)
    existing = await find_folder(db, user_id, name)
    if existing is not None:
        return RunFolder(id=existing.id, name=existing.name)
    return RunFolder(id=None, name=name)


async def resolve_folder(
    db: AsyncSession,
    user_id: uuid.UUID,
    criteria: dict,
    *,
    collection_id: uuid.UUID | None = None,
    new_name: str | None = None,
) -> Collection:
    """The collection to save into, made if needed. In order: the one named in
    the request, a new one typed in the request, the one chosen on the search
    (if it still exists), then the one named after the resume type."""
    if collection_id is not None:
        return await col_svc.get_collection(db, collection_id, user_id)
    if new_name:
        return await make_folder(db, user_id, new_name)
    chosen = await _chosen(db, user_id, criteria)
    if chosen is not None:
        return chosen
    return await make_folder(db, user_id, default_folder_name(criteria))


# --------------------------------------------------------------------------- #
# Saving one finding
# --------------------------------------------------------------------------- #
async def _capture(
    db: AsyncSession, user_id: uuid.UUID, url_key: str
) -> ScoutCapture | None:
    return await db.scalar(
        select(ScoutCapture)
        .where(ScoutCapture.user_id == user_id, ScoutCapture.url_key == url_key)
        .order_by(ScoutCapture.captured_at.desc())
        .limit(1)
    )


def job_track(run: ScoutRun, finding: ScoutFinding) -> uuid.UUID | None:
    """The resume type a saved job is tagged with: the search's own, or for an
    "Anything I'd be good at" search the one Claude said is closest (never the
    hidden broad one)."""
    if (run.criteria or {}).get("broad"):
        return finding.closest_track_id
    return run.track_id


async def save_finding_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    finding: ScoutFinding,
    *,
    source: str,
    track_id: uuid.UUID | None,
    folder_id: uuid.UUID,
    capture: ScoutCapture | None = None,
    anyway: bool = False,
) -> str:
    """Put one finding's job in My Jobs from its page copy (never from anything
    Claude wrote). Returns "saved", "already" (the user had this job; the
    finding now points at it) or "no_copy".

    ``anyway`` (the user's "Save anyway", spec 015): with no page copy, save
    the title, company and link Claude read, with no description. The job then
    counts as needing details, and Job Catcher adds the posting the next time
    the user opens it."""
    capture = capture or await _capture(db, user_id, finding.url_key)
    found = (
        f"Found by Claude Scout on "
        f"{FOUND_ON.get(source) or SOURCE_LABEL.get(source, source)}. "
        f"Claude's fit score: {finding.fit_score}/10."
    )
    if capture is not None:
        job = ManualJobCreate(
            url=posting_link(capture.url),
            title=capture.title,
            company=capture.company,
            location=capture.location or "Not specified",
            is_remote=capture.is_remote,
            description=capture.description,
            salary_min=capture.salary_min,
            salary_max=capture.salary_max,
            salary_period=capture.salary_period,
            job_type=capture.job_type,
            collection_id=folder_id,
            notes=found,
        )
    elif anyway and can_save_anyway(finding):
        job = ManualJobCreate(
            url=posting_link(finding.url),
            title=finding.title[:500],
            company=finding.company[:255],
            location=(finding.location or "Not specified")[:255],
            collection_id=folder_id,
            notes=(
                f"{found} Saved before its page was copied: open the posting "
                "with Job Catcher on and the full description is added."
            ),
        )
    else:
        return "no_copy"
    had_it = (
        await sj_svc.get_saved_listing(
            db, user_id, job.title, job.company, job.location
        )
        is not None
    )
    sj = await sj_svc.save_manual_job(db, user_id, job, origin=ORIGIN_SCOUT)
    finding.saved_job_id = sj.id
    if had_it:
        finding.outcome = DUPLICATE
        finding.app_note = "Already in your tracker"
        return "already"
    if sj.track_id is None:
        sj.track_id = track_id
    finding.outcome = SAVED
    finding.app_note = None
    return "saved"


# --------------------------------------------------------------------------- #
# The user's decision
# --------------------------------------------------------------------------- #
async def confirm_run(
    db: AsyncSession, user_id: uuid.UUID, run: ScoutRun, data: ConfirmIn
) -> ConfirmOut:
    """Save the findings the user ticked; picks they were shown and left
    unticked become "skipped" (still in History, still saveable). Safe to send
    twice. Checks where to save before changing anything."""
    if data.collection_id is not None:  # someone else's: 404 before any change
        await col_svc.get_collection(db, data.collection_id, user_id)
    findings = list(
        await db.scalars(
            select(ScoutFinding)
            .where(ScoutFinding.run_id == run.id, ScoutFinding.user_id == user_id)
            .order_by(ScoutFinding.created_at)
        )
    )
    wanted = set(data.finding_ids)
    shown = None if data.shown_ids is None else set(data.shown_ids)
    out = ConfirmOut(folder=await peek_folder(db, user_id, run.criteria))
    folder: Collection | None = None
    for f in findings:
        if f.id not in wanted:
            if f.outcome == PICKED and (shown is None or f.id in shown):
                f.outcome = SKIPPED
            continue
        if f.saved_job_id is not None and f.outcome in (SAVED, DUPLICATE):
            out.already.append(
                FindingSaved(finding_id=f.id, saved_job_id=f.saved_job_id)
            )
            continue
        if f.outcome not in SAVEABLE:
            out.failed.append(FindingFailed(finding_id=f.id, reason=NO_COPY_REASON))
            continue
        capture = await _capture(db, user_id, f.url_key)
        if capture is None:
            out.failed.append(FindingFailed(finding_id=f.id, reason=NO_COPY_REASON))
            continue
        if folder is None:  # made only once something is really being saved
            folder = await resolve_folder(
                db,
                user_id,
                run.criteria,
                collection_id=data.collection_id,
                new_name=data.new_collection_name,
            )
        result = await save_finding_job(
            db,
            user_id,
            f,
            source=f.source,
            track_id=job_track(run, f),
            folder_id=folder.id,
            capture=capture,
        )
        item = FindingSaved(finding_id=f.id, saved_job_id=f.saved_job_id)
        (out.saved if result == "saved" else out.already).append(item)
    known = {f.id for f in findings}
    for missing in wanted - known:
        out.failed.append(
            FindingFailed(
                finding_id=missing, reason="That job isn't part of this search."
            )
        )
    if folder is not None:
        out.folder = RunFolder(id=folder.id, name=folder.name)
    await db.flush()
    return out


def can_save_anyway(finding: ScoutFinding) -> bool:
    """A finding with no page copy can still be saved ("Save anyway") when
    Claude read its title and company."""
    return (
        finding.outcome in SAVEABLE
        and bool((finding.title or "").strip())
        and bool((finding.company or "").strip())
    )


async def save_one(
    db: AsyncSession, user_id: uuid.UUID, finding_id: uuid.UUID, data: SaveFindingIn
) -> SaveFindingOut:
    """Save a single finding later, from History (one the user skipped, or one
    Claude scored under the bar)."""
    row = (
        await db.execute(
            select(ScoutFinding, ScoutRun)
            .join(ScoutRun, ScoutRun.id == ScoutFinding.run_id)
            .where(ScoutFinding.id == finding_id, ScoutFinding.user_id == user_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="That job isn't in your searches")
    finding, run = row
    if finding.saved_job_id is not None and finding.outcome in (SAVED, DUPLICATE):
        folder = await peek_folder(db, user_id, run.criteria)
        return SaveFindingOut(
            finding_id=finding.id,
            saved_job_id=finding.saved_job_id,
            already=True,
            folder=folder,
        )
    capture = (
        await _capture(db, user_id, finding.url_key)
        if finding.outcome in SAVEABLE
        else None
    )
    if capture is None and not (data.anyway and can_save_anyway(finding)):
        raise HTTPException(status_code=409, detail=NO_COPY_REASON)
    folder = await resolve_folder(
        db,
        user_id,
        run.criteria,
        collection_id=data.collection_id,
        new_name=data.new_collection_name,
    )
    result = await save_finding_job(
        db,
        user_id,
        finding,
        source=finding.source,
        track_id=job_track(run, finding),
        folder_id=folder.id,
        capture=capture,
        anyway=data.anyway,
    )
    await db.flush()
    return SaveFindingOut(
        finding_id=finding.id,
        saved_job_id=finding.saved_job_id,
        already=result == "already",
        folder=RunFolder(id=folder.id, name=folder.name),
    )


async def count_to_review(db: AsyncSession, user_id: uuid.UUID) -> int:
    """How many of Scout's picks are waiting for the user. A count only."""
    return (
        await db.scalar(
            select(func.count()).where(
                ScoutFinding.user_id == user_id, ScoutFinding.outcome == PICKED
            )
        )
        or 0
    )
