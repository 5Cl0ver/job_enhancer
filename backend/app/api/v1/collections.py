"""Collections endpoints (US2 — Save and Organize Jobs)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.collection import CollectionCreate, CollectionSchema, CollectionUpdate
from app.services import collections as svc

router = APIRouter()


@router.get("/", response_model=list[CollectionSchema])
async def list_collections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CollectionSchema]:
    rows = await svc.list_collections(db, user.id)
    return [CollectionSchema.model_validate(r) for r in rows]


@router.post("/", response_model=CollectionSchema, status_code=201)
async def create_collection(
    data: CollectionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CollectionSchema:
    col = await svc.create_collection(db, user.id, data)
    await db.commit()
    return CollectionSchema.model_validate(col)


@router.get("/{collection_id}", response_model=CollectionSchema)
async def get_collection(
    collection_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CollectionSchema:
    col = await svc.get_collection(db, collection_id, user.id)
    return CollectionSchema.model_validate(col)


@router.patch("/{collection_id}", response_model=CollectionSchema)
async def update_collection(
    collection_id: uuid.UUID,
    data: CollectionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CollectionSchema:
    col = await svc.update_collection(db, collection_id, user.id, data)
    await db.commit()
    await db.refresh(col)  # reload server-generated updated_at
    return CollectionSchema.model_validate(col)


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(
    collection_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_collection(db, collection_id, user.id)
    await db.commit()
