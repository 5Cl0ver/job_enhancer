"""CRUD service for SavedJobs."""

import uuid
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.saved_job import SavedJob
from app.schemas.saved_job import SavedJobCreate, SavedJobUpdate


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


async def save_job(db: AsyncSession, user_id: uuid.UUID, data: SavedJobCreate) -> SavedJob:
    sj = SavedJob(id=uuid.uuid4(), user_id=user_id, **data.model_dump())
    db.add(sj)
    try:
        await db.flush()
    except Exception:
        raise HTTPException(status_code=409, detail="Job already saved")
    # Reload with relationship
    return await get_saved_job(db, sj.id, user_id)


async def update_saved_job(
    db: AsyncSession,
    saved_job_id: uuid.UUID,
    user_id: uuid.UUID,
    data: SavedJobUpdate,
) -> SavedJob:
    from datetime import datetime, timezone

    sj = await get_saved_job(db, saved_job_id, user_id)
    updates = data.model_dump(exclude_unset=True)

    # Track stage changes for follow-up reminders
    if "pipeline_stage_id" in updates and updates["pipeline_stage_id"] != sj.pipeline_stage_id:
        sj.last_stage_change = datetime.now(tz=timezone.utc)

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
