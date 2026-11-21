"""Claude Scout endpoints: resume types (tracks), saved searches (missions),
runs, and the extension's page copies. Claude itself talks to the app through
the connector (``app/mcp_server.py``), not these."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.scout import (
    ActiveRunOut,
    CaptureIn,
    CaptureOut,
    CompanyOut,
    CompanyUpdate,
    ConfirmIn,
    ConfirmOut,
    InstructionSave,
    InstructionSection,
    InstructionsOut,
    InstructionVersionOut,
    MissionCreate,
    MissionOut,
    MissionUpdate,
    RunEventOut,
    RunOut,
    SaveFindingIn,
    SaveFindingOut,
    TitleTried,
    TrackCreate,
    TrackOut,
    TrackUpdate,
)
from app.services import scout_companies as companies
from app.services import scout_instructions as instr
from app.services import scout_log
from app.services import scout_review as review
from app.services import scout_runs as runs
from app.services import scout_titles as titles_svc
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


@router.get("/tracks/{track_id}/passes")
async def track_passes(
    track_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The titles Claude passed over for this resume type (spec 011)."""
    return await svc.passes(db, track_id, user.id)


@router.post("/tracks/{track_id}/start-fresh", status_code=204)
async def track_start_fresh(
    track_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Forget the titles Claude passed over for this resume type, and let its
    jobs scored below the bar be looked at again."""
    await svc.start_fresh(db, await svc.get_track(db, track_id, user.id))
    await db.commit()


@router.get("/missions", response_model=list[MissionOut])
async def list_missions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MissionOut]:
    return await runs.missions_out(db, user.id, await runs.list_missions(db, user.id))


@router.post("/missions", response_model=MissionOut, status_code=201)
async def create_mission(
    data: MissionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MissionOut:
    mission = await runs.create_mission(db, user.id, data)
    await db.commit()
    await db.refresh(mission)
    return (await runs.missions_out(db, user.id, [mission]))[0]


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
    return (await runs.missions_out(db, user.id, [mission]))[0]


@router.get("/missions/{mission_id}/titles", response_model=list[TitleTried])
async def mission_titles(
    mission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TitleTried]:
    """The titles an "Anything I'd be good at" search has tried, and how each
    did. 404 for any other search."""
    mission = await runs.get_mission(db, mission_id, user.id)
    track = await svc.get_track(db, mission.track_id, user.id, allow_broad=True)
    if track.kind != svc.BROAD:
        raise HTTPException(status_code=404, detail="Search not found")
    return [
        TitleTried(**t)
        for t in await titles_svc.tried(db, mission.id, mission.overrides)
    ]


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
    run = await runs.open_run(db, user.id)
    return ActiveRunOut(
        run_id=run.id if run else None,
        any_site=await runs.any_site_run(db, user.id) is not None,
    )


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


@router.post("/runs/{run_id}/confirm", response_model=ConfirmOut)
async def confirm_run(
    run_id: uuid.UUID,
    data: ConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConfirmOut:
    """The review's one button: save the findings the user ticked, into the
    collection they chose. Picks left unticked are kept in History."""
    run = await runs.get_run(db, run_id, user.id)
    out = await review.confirm_run(db, user.id, run, data)
    await db.commit()
    return out


@router.post("/findings/{finding_id}/save", response_model=SaveFindingOut)
async def save_finding(
    finding_id: uuid.UUID,
    data: SaveFindingIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SaveFindingOut:
    """Save one job later, from History: one the user skipped, or one Claude
    scored under the bar."""
    out = await review.save_one(db, user.id, finding_id, data)
    await db.commit()
    return out


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


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CompanyOut]:
    """The local companies Scout has checked, latest first."""
    return await companies.list_companies(db, user.id)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: uuid.UUID,
    data: CompanyUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CompanyOut:
    """Never check a company again (or start again), or check it next run."""
    out = await companies.update_company(db, user.id, company_id, data)
    await db.commit()
    return out


# --------------------------------------------------------------------------- #
# The Instructions page and the run log (spec 010)
# --------------------------------------------------------------------------- #
@router.get("/instructions", response_model=InstructionsOut)
async def instructions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InstructionsOut:
    """Everything Claude Scout tells Claude: the user's own versions where they
    edited, the originals elsewhere, and the parts that are locked."""
    from app import mcp_server  # the tools' own descriptions, as Claude sees them

    sections = await instr.sections(db, user.id)
    weights = next(s["current"] for s in sections if s["key"] == "rubric")
    return InstructionsOut(
        sections=[InstructionSection(**s) for s in sections],
        rubric_text=instr.rubric_text(weights),
        locked_rules=instr.RULES,
        connector_note=mcp_server.mcp.instructions or "",
        tools=mcp_server.scout_tool_descriptions(),
        fixed_limits=[{"label": k, "value": v} for k, v in instr.FIXED_LIMITS],
    )


@router.put("/instructions/{key}", response_model=InstructionSection)
async def save_instruction(
    key: str,
    data: InstructionSave,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InstructionSection:
    out = await instr.save(db, user.id, key, data.text, data.values)
    await db.commit()
    return InstructionSection(**out)


@router.post("/instructions/{key}/reset", response_model=InstructionSection)
async def reset_instruction(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InstructionSection:
    out = await instr.reset(db, user.id, key)
    await db.commit()
    return InstructionSection(**out)


@router.get("/instructions/{key}/history", response_model=list[InstructionVersionOut])
async def instruction_history(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[InstructionVersionOut]:
    return [InstructionVersionOut(**v) for v in await instr.history(db, user.id, key)]


@router.post(
    "/instructions/{key}/restore/{version_id}", response_model=InstructionSection
)
async def restore_instruction(
    key: str,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InstructionSection:
    out = await instr.restore(db, user.id, key, version_id)
    await db.commit()
    return InstructionSection(**out)


@router.get("/missions/{mission_id}/preview")
async def preview_mission(
    mission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """What Claude would be given if this search started now. It only reads:
    nothing is created or marked."""
    return await runs.preview(db, user.id, mission_id)


@router.get("/runs/{run_id}/log", response_model=list[RunEventOut])
async def run_log(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RunEventOut]:
    return [
        RunEventOut.model_validate(e)
        for e in await scout_log.events(db, user.id, run_id)
    ]
