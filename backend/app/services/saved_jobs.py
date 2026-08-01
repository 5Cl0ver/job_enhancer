"""CRUD service for SavedJobs."""

import uuid
from collections.abc import Sequence
from datetime import UTC

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.schemas.saved_job import ManualJobCreate, SavedJobCreate, SavedJobUpdate
from app.services.dedup import job_content_hash, normalize


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
            content_hash=content_hash,
            title_normalized=title_norm,
            company_normalized=company_norm,
        )
        db.add(listing)
        await db.flush()

    return await save_job(
        db,
        user_id,
        SavedJobCreate(
            job_listing_id=listing.id,
            collection_id=data.collection_id,
            notes=data.notes,
        ),
    )


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
