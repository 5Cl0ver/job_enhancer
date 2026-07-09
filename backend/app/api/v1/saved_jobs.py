"""Saved jobs endpoints (US2 — Save and Organize Jobs)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import CurrentUser
from app.schemas.saved_job import SavedJobCreate, SavedJobSchema, SavedJobUpdate
from app.services import saved_jobs as svc

router = APIRouter()


@router.get("/", response_model=list[SavedJobSchema])
async def list_saved_jobs(
    collection_id: uuid.UUID | None = Query(None),
    pipeline_stage_id: uuid.UUID | None = Query(None),
    is_archived: bool = Query(False),
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[SavedJobSchema]:
    rows = await svc.list_saved_jobs(db, user.id, collection_id, pipeline_stage_id, is_archived)
    return [SavedJobSchema.model_validate(r) for r in rows]


@router.post("/", response_model=SavedJobSchema, status_code=201)
async def save_job(
    data: SavedJobCreate,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    sj = await svc.save_job(db, user.id, data)
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.patch("/{saved_job_id}", response_model=SavedJobSchema)
async def update_saved_job(
    saved_job_id: uuid.UUID,
    data: SavedJobUpdate,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    sj = await svc.update_saved_job(db, saved_job_id, user.id, data)
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.delete("/{saved_job_id}", status_code=204)
async def delete_saved_job(
    saved_job_id: uuid.UUID,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_saved_job(db, saved_job_id, user.id)
    await db.commit()
