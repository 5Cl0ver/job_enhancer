"""Tracker service — pipeline stage CRUD and job movement."""

import uuid
from datetime import datetime, timezone
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pipeline_stage import DEFAULT_STAGES, PipelineStage
from app.models.saved_job import SavedJob
from app.schemas.pipeline_stage import PipelineStageCreate, PipelineStageUpdate


async def seed_default_stages(db: AsyncSession, user_id: uuid.UUID) -> list[PipelineStage]:
    """Create the 8 default Kanban stages for a new user."""
    stages = []
    for stage_data in DEFAULT_STAGES:
        stage = PipelineStage(
            id=uuid.uuid4(),
            user_id=user_id,
            is_default=True,
            **stage_data,
        )
        db.add(stage)
        stages.append(stage)
    await db.flush()
    return stages


async def list_stages(db: AsyncSession, user_id: uuid.UUID) -> Sequence[PipelineStage]:
    result = await db.execute(
        select(PipelineStage)
        .where(PipelineStage.user_id == user_id)
        .order_by(PipelineStage.sort_order)
    )
    return result.scalars().all()


async def get_stage(
    db: AsyncSession, stage_id: uuid.UUID, user_id: uuid.UUID
) -> PipelineStage:
    stage = await db.scalar(
        select(PipelineStage).where(
            PipelineStage.id == stage_id, PipelineStage.user_id == user_id
        )
    )
    if not stage:
        raise HTTPException(status_code=404, detail="Pipeline stage not found")
    return stage


async def create_stage(
    db: AsyncSession, user_id: uuid.UUID, data: PipelineStageCreate
) -> PipelineStage:
    stage = PipelineStage(id=uuid.uuid4(), user_id=user_id, **data.model_dump())
    db.add(stage)
    try:
        await db.flush()
    except Exception:
        raise HTTPException(status_code=409, detail="A stage with that name already exists")
    return stage


async def update_stage(
    db: AsyncSession,
    stage_id: uuid.UUID,
    user_id: uuid.UUID,
    data: PipelineStageUpdate,
) -> PipelineStage:
    stage = await get_stage(db, stage_id, user_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(stage, key, value)
    await db.flush()
    return stage


async def delete_stage(
    db: AsyncSession, stage_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    stage = await get_stage(db, stage_id, user_id)
    if stage.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete a default pipeline stage")
    await db.delete(stage)
    await db.flush()


async def move_job_to_stage(
    db: AsyncSession,
    saved_job_id: uuid.UUID,
    stage_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> SavedJob:
    """Move a saved job to a new pipeline stage, tracking timestamps."""
    sj = await db.scalar(
        select(SavedJob).where(
            SavedJob.id == saved_job_id, SavedJob.user_id == user_id
        )
    )
    if not sj:
        raise HTTPException(status_code=404, detail="Saved job not found")

    now = datetime.now(tz=timezone.utc)

    if stage_id is not None:
        # Validate stage belongs to this user
        stage = await get_stage(db, stage_id, user_id)
        # Set applied_at once when moving to "Applied"
        if stage.name == "Applied" and sj.applied_at is None:
            sj.applied_at = now

    sj.pipeline_stage_id = stage_id
    sj.last_stage_change = now
    await db.flush()
    return sj
