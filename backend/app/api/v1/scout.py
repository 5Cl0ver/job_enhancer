"""Claude Scout endpoints: resume types (tracks)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.scout import TrackCreate, TrackOut, TrackUpdate
from app.services import scout_tracks as svc

router = APIRouter()


@router.get("/tracks", response_model=list[TrackOut])
async def list_tracks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TrackOut]:
    return await svc.to_out(db, await svc.list_tracks(db, user.id), user.id)


@router.post("/tracks", response_model=TrackOut, status_code=201)
async def create_track(
    data: TrackCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TrackOut:
    track = await svc.create_track(db, user.id, data)
    await db.commit()
    await db.refresh(track)
    return (await svc.to_out(db, [track], user.id))[0]


@router.patch("/tracks/{track_id}", response_model=TrackOut)
async def update_track(
    track_id: uuid.UUID,
    data: TrackUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TrackOut:
    track = await svc.update_track(db, track_id, user.id, data)
    await db.commit()
    await db.refresh(track)
    return (await svc.to_out(db, [track], user.id))[0]


@router.delete("/tracks/{track_id}", status_code=204)
async def delete_track(
    track_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_track(db, track_id, user.id)
    await db.commit()
