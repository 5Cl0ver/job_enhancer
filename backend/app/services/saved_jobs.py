"""CRUD service for SavedJobs."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from urllib.parse import quote_plus

from fastapi import HTTPException
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.schemas.saved_job import (
    ApplicationSyncItem,
    ApplicationSyncOutcome,
    ApplicationSyncResult,
    ManualJobCreate,
    SavedJobCreate,
    SavedJobUpdate,
)
from app.services.dedup import job_content_hash, normalize

# Same thresholds the dedup service uses, so "is this the job I saved?" is judged
# the same way across the app (title ≥88, company ≥85 token_sort_ratio).
_SYNC_TITLE_THRESHOLD = 88
_SYNC_COMPANY_THRESHOLD = 85


async def list_saved_jobs(
    db: AsyncSession,
    user_id: uuid.UUID,
    collection_id: uuid.UUID | None = None,
    pipeline_stage_id: uuid.UUID | None = None,
    is_archived: bool = False,
) -> Sequence[SavedJob]:
    stmt = (
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(SavedJob.user_id == user_id, SavedJob.is_archived == is_archived)
    )
    if collection_id is not None:
        stmt = stmt.where(SavedJob.collection_id == collection_id)
    if pipeline_stage_id is not None:
        stmt = stmt.where(SavedJob.pipeline_stage_id == pipeline_stage_id)
    stmt = stmt.order_by(SavedJob.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


async def get_saved_job(
    db: AsyncSession, saved_job_id: uuid.UUID, user_id: uuid.UUID
) -> SavedJob:
    sj = await db.scalar(
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if not sj:
        raise HTTPException(status_code=404, detail="Saved job not found")
    return sj


# A listing with less than this much description text is "thin" — the extension
# should send full details when it can see them (passive backfill).
MIN_DESCRIPTION_CHARS = 200


async def get_saved_listing(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    company: str = "",
    location: str = "",
) -> JobListing | None:
    """The listing for this job IF this user has saved it, else None. Matches by
    the same content hash used for dedup, so the extension can show "already
    saved" (and whether details are still missing) before a click."""
    content_hash = job_content_hash(
        normalize(title), normalize(company), normalize(location)
    )
    listing = await db.scalar(
        select(JobListing).where(JobListing.content_hash == content_hash)
    )
    if listing is None:
        return None
    saved_id = await db.scalar(
        select(SavedJob.id).where(
            SavedJob.user_id == user_id, SavedJob.job_listing_id == listing.id
        )
    )
    return listing if saved_id is not None else None


def listing_needs_details(listing: JobListing) -> bool:
    """Thin description OR no salary — either way, invite the extension to send
    full details next time the user is on the job's page."""
    thin_description = len(listing.description or "") < MIN_DESCRIPTION_CHARS
    no_salary = listing.salary_min is None and listing.salary_max is None
    return thin_description or no_salary


async def backfill_job_details(
    db: AsyncSession, user_id: uuid.UUID, data: ManualJobCreate
) -> list[str]:
    """Upgrade a saved job's listing with richer details captured later.

    Passive backfill: the user saved a job from a feed (thin — title only),
    and later opened the actual job page, where the extension can capture the
    full description/salary. Only jobs the USER has saved can be backfilled,
    and fields are only ever upgraded (longer description, filling empty
    salary/job_type) — never downgraded. Returns the list of updated fields.
    """
    listing = await get_saved_listing(
        db, user_id, data.title, data.company, data.location
    )
    if listing is None:
        return []

    updated: list[str] = []
    # A longer description is a fuller one (feed snippet -> real posting).
    if data.description and len(data.description) > len(listing.description or ""):
        listing.description = data.description
        updated.append("description")
    if data.salary_min and not listing.salary_min:
        listing.salary_min = data.salary_min
        updated.append("salary_min")
    if data.salary_max and not listing.salary_max:
        listing.salary_max = data.salary_max
        updated.append("salary_max")
    if (
        data.salary_period
        and not listing.salary_period
        and ("salary_min" in updated or "salary_max" in updated)
    ):
        listing.salary_period = data.salary_period
        updated.append("salary_period")
    if data.job_type and not listing.job_type:
        listing.job_type = data.job_type
        updated.append("job_type")
    # is_remote is CORRECTED, not just filled: early captures falsely flagged
    # on-site jobs as Remote (full-page text scan); the capture sent from the
    # job's own page is the trustworthy signal.
    if data.is_remote != listing.is_remote:
        listing.is_remote = data.is_remote
        updated.append("is_remote")

    if updated:
        await db.flush()
    return updated


async def save_job(
    db: AsyncSession, user_id: uuid.UUID, data: SavedJobCreate
) -> SavedJob:
    sj = SavedJob(id=uuid.uuid4(), user_id=user_id, **data.model_dump())
    db.add(sj)
    try:
        await db.flush()
    except IntegrityError as e:
        # Only a real duplicate (the user↔listing unique constraint) is a 409.
        # Any other integrity error is a genuine bug — don't disguise it as
        # "already saved" (that masked a NOT NULL violation for a long time).
        # Match on both Postgres (constraint name) and SQLite (column list).
        orig = str(getattr(e, "orig", e)).lower()
        is_duplicate = "uq_saved_job_user_listing" in orig or (
            "unique" in orig and "job_listing_id" in orig
        )
        if is_duplicate:
            raise HTTPException(status_code=409, detail="Job already saved") from None
        raise
    # Reload with relationship
    return await get_saved_job(db, sj.id, user_id)


async def save_manual_job(
    db: AsyncSession, user_id: uuid.UUID, data: ManualJobCreate
) -> SavedJob:
    """Save a job the user found on an external site (FR-004a).

    Creates a `JobListing` with source="manual" — or reuses an existing
    listing when the same title/company/location is already known — then
    saves it for the user like any searched job.
    """
    title_norm = normalize(data.title)
    company_norm = normalize(data.company)
    location_norm = normalize(data.location)
    content_hash = job_content_hash(title_norm, company_norm, location_norm)

    listing = await db.scalar(
        select(JobListing).where(JobListing.content_hash == content_hash)
    )
    if listing is None:
        listing = JobListing(
            id=uuid.uuid4(),
            external_id=f"manual:{uuid.uuid4()}",
            source="manual",
            title=data.title,
            company=data.company,
            location=data.location,
            is_remote=data.is_remote,
            apply_url=data.url,
            description=data.description,
            salary_min=data.salary_min,
            salary_max=data.salary_max,
            salary_period=data.salary_period,
            job_type=data.job_type,
            content_hash=content_hash,
            title_normalized=title_norm,
            company_normalized=company_norm,
        )
        db.add(listing)
        await db.flush()
    else:
        # An explicit, user-reviewed save from the capture card: honor the
        # details the user typed/fixed. Overwrite the stored listing when they
        # provided a value (but never wipe a field back to empty). This is what
        # makes editing the description in the review card actually stick.
        if data.description:
            listing.description = data.description
        if data.salary_min:
            listing.salary_min = data.salary_min
        if data.salary_max:
            listing.salary_max = data.salary_max
        if data.salary_period and (data.salary_min or data.salary_max):
            listing.salary_period = data.salary_period
        if data.job_type:
            listing.job_type = data.job_type
        listing.is_remote = data.is_remote
        await db.flush()

    # Already in the user's tracker? Then the edits above are the whole point of
    # this call — return the existing entry (so those edits commit) instead of
    # attempting a duplicate insert that 409s and rolls the whole transaction
    # back, silently discarding the user's change.
    existing = await db.scalar(
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(
            SavedJob.user_id == user_id,
            SavedJob.job_listing_id == listing.id,
        )
    )
    if existing:
        return existing

    return await save_job(
        db,
        user_id,
        SavedJobCreate(
            job_listing_id=listing.id,
            collection_id=data.collection_id,
            notes=data.notes,
        ),
    )


async def mark_applied(
    db: AsyncSession, user_id: uuid.UUID, title: str, company: str
) -> bool:
    """Auto-track: the extension saw the user SUBMIT an application — move the
    matching saved job to Applied. Prefers a title+company match; falls back to
    company-only (Indeed's confirmation states just the company) picking the
    most recent not-yet-applied saved job there. No match → no-op: we never
    invent tracker entries."""
    title_norm = normalize(title)
    company_norm = normalize(company)
    if not title_norm and not company_norm:
        return False

    base = (
        select(SavedJob)
        .join(JobListing, SavedJob.job_listing_id == JobListing.id)
        .where(SavedJob.user_id == user_id)
    )
    sj = None
    if title_norm and company_norm:
        sj = await db.scalar(
            base.where(
                JobListing.title_normalized == title_norm,
                JobListing.company_normalized == company_norm,
            ).limit(1)
        )
    if sj is None and company_norm:
        # Company-only fallback: prefer a job not already applied, newest first.
        sj = await db.scalar(
            base.where(JobListing.company_normalized == company_norm)
            .order_by(SavedJob.applied_at.is_(None).desc(), SavedJob.created_at.desc())
            .limit(1)
        )
    if sj is None:
        return False

    now = datetime.now(UTC)
    if sj.applied_at is None:
        sj.applied_at = now
    stage = await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == user_id, PipelineStage.name == "Applied"
        )
    )
    if stage and sj.pipeline_stage_id != stage.id:
        sj.pipeline_stage_id = stage.id
        sj.last_stage_change = now
    await db.flush()
    return True


def _best_saved_match(
    title_norm: str,
    company_norm: str,
    candidates: list[tuple[SavedJob, str, str]],
) -> SavedJob | None:
    """The user's saved job that best matches an incoming application by fuzzy
    title+company, or None. Same scoring as dedup so it agrees with the rest of
    the app."""
    best: SavedJob | None = None
    best_title = 0
    for sj, cand_title, cand_company in candidates:
        if fuzz.token_sort_ratio(company_norm, cand_company) < _SYNC_COMPANY_THRESHOLD:
            continue
        title_score = fuzz.token_sort_ratio(title_norm, cand_title)
        if title_score >= _SYNC_TITLE_THRESHOLD and title_score > best_title:
            best = sj
            best_title = title_score
    return best


def _fallback_url(title: str, company: str) -> str:
    """A valid listing URL for an imported application when the board didn't
    give a per-job link — a search that lands the user on the posting."""
    q = quote_plus(f"{title} {company}".strip()) or "jobs"
    return f"https://www.indeed.com/jobs?q={q}"


async def sync_applications(
    db: AsyncSession,
    user_id: uuid.UUID,
    items: list[ApplicationSyncItem],
) -> ApplicationSyncResult:
    """Reconcile a batch of applications the user already made on a job board
    (read off their 'My jobs' list by the extension) with their tracker:

      • fuzzy-match each to a saved job → move it to the target stage, and
      • import the rest as new tracked jobs at that stage.

    The extension supplies the target stage NAME (already mapped from the board's
    status badge); we resolve it to the user's PipelineStage and never invent a
    stage the user doesn't have (falling back to 'Applied')."""
    stages = {
        s.name.lower(): s
        for s in (
            await db.execute(
                select(PipelineStage).where(PipelineStage.user_id == user_id)
            )
        ).scalars()
    }
    saved = (
        (
            await db.execute(
                select(SavedJob)
                .options(selectinload(SavedJob.job_listing))
                .where(SavedJob.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    candidates: list[tuple[SavedJob, str, str]] = [
        (
            sj,
            sj.job_listing.title_normalized or normalize(sj.job_listing.title or ""),
            sj.job_listing.company_normalized
            or normalize(sj.job_listing.company or ""),
        )
        for sj in saved
        if sj.job_listing is not None
    ]

    result = ApplicationSyncResult()
    now = datetime.now(UTC)

    for item in items:
        title_norm = normalize(item.title)
        company_norm = normalize(item.company)
        stage = stages.get(item.stage.lower()) or stages.get("applied")
        applied_ts = item.applied_at or now

        if not title_norm:
            result.skipped += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="skipped",
                )
            )
            continue

        match = _best_saved_match(title_norm, company_norm, candidates)
        if match is not None:
            if stage and match.pipeline_stage_id != stage.id:
                match.pipeline_stage_id = stage.id
                match.last_stage_change = now
            if match.applied_at is None:
                match.applied_at = applied_ts
            result.updated += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="updated",
                )
            )
            continue

        # No match — import it as a new tracked job at the target stage.
        try:
            sj = await save_manual_job(
                db,
                user_id,
                ManualJobCreate(
                    url=item.url or _fallback_url(item.title, item.company),
                    title=item.title,
                    company=item.company,
                    location=item.location or "Not specified",
                ),
            )
        except HTTPException:
            # An unexpected exact-duplicate collision — treat as already tracked.
            result.skipped += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="skipped",
                )
            )
            continue

        if stage:
            sj.pipeline_stage_id = stage.id
            sj.last_stage_change = now
        sj.applied_at = applied_ts
        # Make it matchable for later items in the same batch (dedupes the list).
        candidates.append((sj, title_norm, company_norm))
        result.imported += 1
        result.outcomes.append(
            ApplicationSyncOutcome(
                title=item.title,
                company=item.company,
                stage=item.stage,
                action="imported",
            )
        )

    await db.flush()
    return result


async def update_saved_job(
    db: AsyncSession,
    saved_job_id: uuid.UUID,
    user_id: uuid.UUID,
    data: SavedJobUpdate,
) -> SavedJob:
    from datetime import datetime

    sj = await get_saved_job(db, saved_job_id, user_id)
    updates = data.model_dump(exclude_unset=True)

    # Track stage changes for follow-up reminders
    if (
        "pipeline_stage_id" in updates
        and updates["pipeline_stage_id"] != sj.pipeline_stage_id
    ):
        sj.last_stage_change = datetime.now(tz=UTC)

    for key, value in updates.items():
        setattr(sj, key, value)

    await db.flush()
    return sj


async def delete_saved_job(
    db: AsyncSession, saved_job_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    sj = await get_saved_job(db, saved_job_id, user_id)
    await db.delete(sj)
    await db.flush()
