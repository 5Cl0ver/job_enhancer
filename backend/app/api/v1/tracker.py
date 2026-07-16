"""Pipeline / Kanban tracker endpoints (US3 — Track Application Status)."""

import uuid

from fastapi import APIRouter, Body, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.pipeline_stage import (
    PipelineStageCreate,
    PipelineStageSchema,
    PipelineStageUpdate,
)
from app.schemas.saved_job import SavedJobSchema
from app.services import tracker as svc

router = APIRouter()


@router.get("/", response_model=list[PipelineStageSchema])
async def list_stages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PipelineStageSchema]:
    stages = await svc.list_stages(db, user.id)
    return [PipelineStageSchema.model_validate(s) for s in stages]


@router.post("/", response_model=PipelineStageSchema, status_code=201)
async def create_stage(
    data: PipelineStageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PipelineStageSchema:
    stage = await svc.create_stage(db, user.id, data)
    await db.commit()
    return PipelineStageSchema.model_validate(stage)


@router.patch("/{stage_id}", response_model=PipelineStageSchema)
async def update_stage(
    stage_id: uuid.UUID,
    data: PipelineStageUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PipelineStageSchema:
    stage = await svc.update_stage(db, stage_id, user.id, data)
    await db.commit()
    return PipelineStageSchema.model_validate(stage)


@router.delete("/{stage_id}", status_code=204)
async def delete_stage(
    stage_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_stage(db, stage_id, user.id)
    await db.commit()


@router.post("/move", response_model=SavedJobSchema)
async def move_job(
    saved_job_id: uuid.UUID = Body(...),
    stage_id: uuid.UUID | None = Body(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    """Move a saved job to a different Kanban column."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.saved_job import SavedJob

    sj = await svc.move_job_to_stage(db, saved_job_id, stage_id, user.id)
    await db.commit()
    # Reload with job_listing relationship
    sj = await db.scalar(
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(SavedJob.id == sj.id)
    )
    return SavedJobSchema.model_validate(sj)
