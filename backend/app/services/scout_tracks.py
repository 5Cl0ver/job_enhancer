"""Resume types (tracks) for Claude Scout: create, list, edit, delete.

A user keeps at most ``MAX_TRACKS``; names are unique per user (any case). An
attached resume must be one of the user's own uploads. Deleting a track leaves
its jobs saved, just untagged.
"""

import uuid
from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resume import Resume
from app.models.resume_track import ResumeTrack
from app.models.saved_job import SavedJob
from app.schemas.scout import MAX_TRACKS, TrackCreate, TrackOut, TrackUpdate


async def list_tracks(db: AsyncSession, user_id: uuid.UUID) -> Sequence[ResumeTrack]:
    return (
        await db.scalars(
            select(ResumeTrack)
            .where(ResumeTrack.user_id == user_id)
            .order_by(ResumeTrack.sort_order, ResumeTrack.created_at)
        )
    ).all()


async def get_track(
    db: AsyncSession, track_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeTrack:
    track = await db.scalar(
        select(ResumeTrack).where(
            ResumeTrack.id == track_id, ResumeTrack.user_id == user_id
        )
    )
    if track is None:
        raise HTTPException(status_code=404, detail="Resume type not found")
    return track


async def _check_resume(
    db: AsyncSession, resume_id: uuid.UUID | None, user_id: uuid.UUID
) -> None:
    if resume_id is None:
        return
    owned = await db.scalar(
        select(Resume.id).where(Resume.id == resume_id, Resume.user_id == user_id)
    )
    if owned is None:
        raise HTTPException(status_code=422, detail="That resume isn't one of yours")


async def _check_name(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    except_id: uuid.UUID | None = None,
) -> None:
    query = select(ResumeTrack.id).where(
        ResumeTrack.user_id == user_id,
        func.lower(ResumeTrack.name) == name.lower(),
    )
    if except_id is not None:
        query = query.where(ResumeTrack.id != except_id)
    if await db.scalar(query) is not None:
        raise HTTPException(
            status_code=409, detail=f"You already have a resume type called “{name}”"
        )


async def create_track(
    db: AsyncSession, user_id: uuid.UUID, data: TrackCreate
) -> ResumeTrack:
    count = await db.scalar(
        select(func.count(ResumeTrack.id)).where(ResumeTrack.user_id == user_id)
    )
    if (count or 0) >= MAX_TRACKS:
        raise HTTPException(
            status_code=422,
            detail=f"You can keep up to {MAX_TRACKS} resume types. Delete one first.",
        )
    await _check_name(db, user_id, data.name)
    await _check_resume(db, data.resume_id, user_id)
    track = ResumeTrack(
        id=uuid.uuid4(),
        user_id=user_id,
        name=data.name,
        target_titles=data.target_titles,
        key_skills=data.key_skills,
        skip_rules=data.skip_rules.model_dump(),
        min_pay=data.min_pay,
        resume_id=data.resume_id,
        notes=data.notes,
        sort_order=count or 0,
    )
    db.add(track)
    await db.flush()
    return track


async def update_track(
    db: AsyncSession, track_id: uuid.UUID, user_id: uuid.UUID, data: TrackUpdate
) -> ResumeTrack:
    track = await get_track(db, track_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("name") is not None:
        await _check_name(db, user_id, updates["name"], except_id=track.id)
    if "resume_id" in updates:
        await _check_resume(db, updates["resume_id"], user_id)
    for key, value in updates.items():
        if value is None and key in (
            "name",
            "target_titles",
            "key_skills",
            "skip_rules",
        ):
            continue  # required fields: null means "leave as is"
        setattr(track, key, value)
    await db.flush()
    return track


async def delete_track(
    db: AsyncSession, track_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    track = await get_track(db, track_id, user_id)
    # The FK clears this on Postgres; do it explicitly so every database agrees.
    await db.execute(
        update(SavedJob)
        .where(SavedJob.user_id == user_id, SavedJob.track_id == track.id)
        .values(track_id=None)
    )
    await db.delete(track)
    await db.flush()


async def to_out(
    db: AsyncSession, tracks: Sequence[ResumeTrack], user_id: uuid.UUID
) -> list[TrackOut]:
    """Tracks plus each one's resume file name and number of saved jobs."""
    if not tracks:
        return []
    resume_ids = {t.resume_id for t in tracks if t.resume_id}
    names = (
        dict(
            (
                await db.execute(
                    select(Resume.id, Resume.filename).where(
                        Resume.id.in_(resume_ids), Resume.user_id == user_id
                    )
                )
            ).all()
        )
        if resume_ids
        else {}
    )
    counts = dict(
        (
            await db.execute(
                select(SavedJob.track_id, func.count(SavedJob.id))
                .where(
                    SavedJob.user_id == user_id,
                    SavedJob.track_id.in_([t.id for t in tracks]),
                    SavedJob.is_archived.is_(False),
                )
                .group_by(SavedJob.track_id)
            )
        ).all()
    )
    out = []
    for t in tracks:
        o = TrackOut.model_validate(t)
        o.resume_filename = names.get(t.resume_id)
        o.job_count = counts.get(t.id, 0)
        out.append(o)
    return out
