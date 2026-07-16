"""Saved searches + New Matches feed endpoints (FR-024)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.saved_search import (
    NewMatchesResponse,
    SavedSearchCreate,
    SavedSearchSchema,
)
from app.services import saved_searches as svc

router = APIRouter()


@router.get("/", response_model=list[SavedSearchSchema])
async def list_saved_searches(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SavedSearchSchema]:
    rows = await svc.list_saved_searches(db, user.id)
    return [SavedSearchSchema.model_validate(r) for r in rows]


@router.post("/", response_model=SavedSearchSchema, status_code=201)
async def create_saved_search(
    data: SavedSearchCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedSearchSchema:
    search = await svc.create_saved_search(db, user.id, data)
    await db.commit()
    return SavedSearchSchema.model_validate(search)


@router.get("/matches", response_model=NewMatchesResponse)
async def get_new_matches(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NewMatchesResponse:
    """Jobs found since each saved search was last viewed."""
    return await svc.get_new_matches(db, user.id)


@router.post("/mark-seen", status_code=204)
async def mark_matches_seen(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.mark_matches_seen(db, user.id)
    await db.commit()


@router.delete("/{search_id}", status_code=204)
async def delete_saved_search(
    search_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_saved_search(db, search_id, user.id)
    await db.commit()
