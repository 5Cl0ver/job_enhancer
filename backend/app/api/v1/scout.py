"""Claude Scout endpoints: resume types (tracks), saved searches (missions),
runs, and the extension's page copies. Claude itself talks to the app through
the connector (``app/mcp_server.py``), not these."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.scout import (
    ActiveRunOut,
    CaptureIn,
    CaptureOut,
    MissionCreate,
    MissionOut,
    MissionUpdate,
    RunOut,
    TrackCreate,
    TrackOut,
    TrackUpdate,
)
from app.services import scout_runs as runs
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


@router.get("/missions", response_model=list[MissionOut])
async def list_missions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MissionOut]:
    return [MissionOut.model_validate(m) for m in await runs.list_missions(db, user.id)]


@router.post("/missions", response_model=MissionOut, status_code=201)
async def create_mission(
    data: MissionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MissionOut:
    mission = await runs.create_mission(db, user.id, data)
    await db.commit()
    await db.refresh(mission)
    return MissionOut.model_validate(mission)


@router.patch("/missions/{mission_id}", response_model=MissionOut)
async def update_mission(
    mission_id: uuid.UUID,
    data: MissionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MissionOut:
    mission = await runs.update_mission(db, mission_id, user.id, data)
    await db.commit()
    await db.refresh(mission)
    return MissionOut.model_validate(mission)


@router.delete("/missions/{mission_id}", status_code=204)
async def delete_mission(
    mission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await runs.delete_mission(db, mission_id, user.id)
    await db.commit()


@router.post("/missions/{mission_id}/runs", response_model=RunOut, status_code=201)
async def start_run(
    mission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    """Start = queue a run. Claude picks it up with the one fixed line."""
    run = await runs.queue_run(db, mission_id, user.id)
    await db.commit()
    await db.refresh(run)
    return (await runs.runs_out(db, [run]))[0]


@router.get("/runs", response_model=list[RunOut])
async def list_runs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RunOut]:
    return await runs.runs_out(db, await runs.list_runs(db, user.id))


# Before /runs/{run_id}, so "active" isn't read as a run id.
@router.get("/runs/active", response_model=ActiveRunOut)
async def active_run(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActiveRunOut:
    return ActiveRunOut(run_id=await runs.active_run_id(db, user.id))


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await runs.get_run(db, run_id, user.id)
    return (await runs.runs_out(db, [run], with_findings=True))[0]


@router.post("/runs/{run_id}/stop", response_model=RunOut)
async def stop_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await runs.stop_run(db, run_id, user.id)
    await db.commit()
    await db.refresh(run)
    return (await runs.runs_out(db, [run], with_findings=True))[0]


@router.post("/captures", response_model=CaptureOut)
async def capture(
    data: CaptureIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CaptureOut:
    """The extension's exact copy of a job page Claude opened during a run."""
    stored = await runs.record_capture(db, user.id, data)
    await db.commit()
    return CaptureOut(stored=stored)
