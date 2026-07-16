"""CRUD service for Collections."""

import uuid
from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.schemas.collection import CollectionCreate, CollectionUpdate


async def create_default_collection(db: AsyncSession, user_id: uuid.UUID) -> Collection:
    """Create the default 'Saved' collection for a new user."""
    col = Collection(
        id=uuid.uuid4(),
        user_id=user_id,
        name="Saved",
        is_default=True,
        sort_order=0,
    )
    db.add(col)
    await db.flush()
    return col


async def list_collections(
    db: AsyncSession, user_id: uuid.UUID
) -> Sequence[Collection]:
    result = await db.execute(
        select(Collection)
        .where(Collection.user_id == user_id)
        .order_by(Collection.sort_order, Collection.created_at)
    )
    return result.scalars().all()


async def get_collection(
    db: AsyncSession, collection_id: uuid.UUID, user_id: uuid.UUID
) -> Collection:
    col = await db.scalar(
        select(Collection).where(
            Collection.id == collection_id, Collection.user_id == user_id
        )
    )
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    return col


async def create_collection(
    db: AsyncSession, user_id: uuid.UUID, data: CollectionCreate
) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        user_id=user_id,
        **data.model_dump(),
    )
    db.add(col)
    try:
        await db.flush()
    except Exception:
        raise HTTPException(
            status_code=409, detail="A collection with that name already exists"
        ) from None
    return col


async def update_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
    user_id: uuid.UUID,
    data: CollectionUpdate,
) -> Collection:
    col = await get_collection(db, collection_id, user_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(col, key, value)
    await db.flush()
    return col


async def delete_collection(
    db: AsyncSession, collection_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    col = await get_collection(db, collection_id, user_id)
    if col.is_default:
        raise HTTPException(
            status_code=400, detail="Cannot delete the default collection"
        )
    await db.delete(col)
    await db.flush()
