"""Review actions for detected email events — approve, dismiss, undo.

The user-driven half of email auto-status. Detection only ever writes a PENDING
event; the actual card move happens *here*, when the user approves it — and is
reversed here when they undo. Every action is scoped to the owning user, and the
event's ``status`` is left as the durable record of what happened.
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import (
    STATUS_APPLIED,
    STATUS_AUTO_APPLIED,
    STATUS_DISMISSED,
    STATUS_PENDING,
    DetectedEvent,
)
from app.models.pipeline_stage import PipelineStage
from app.services.tracker import move_job_to_stage


async def _get_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    ev = await db.scalar(
        select(DetectedEvent).where(
            DetectedEvent.id == event_id, DetectedEvent.user_id == user_id
        )
    )
    if not ev:
        raise HTTPException(status_code=404, detail="Detected event not found")
    return ev


async def list_pending(db: AsyncSession, user_id: uuid.UUID) -> list[DetectedEvent]:
    """Events awaiting the user's review, newest first."""
    rows = await db.scalars(
        select(DetectedEvent)
        .where(
            DetectedEvent.user_id == user_id,
            DetectedEvent.status == STATUS_PENDING,
        )
        .order_by(DetectedEvent.created_at.desc())
    )
    return list(rows)


async def apply_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Approve a pending event: move the card to the target stage (if any) and
    mark it applied. A recruiter contact has no target stage — it just logs."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Event already reviewed")

    if ev.target_stage:
        stage = await db.scalar(
            select(PipelineStage).where(
                PipelineStage.user_id == user_id,
                PipelineStage.name == ev.target_stage,
            )
        )
        # If the user deleted that stage, skip the move but still record the
        # review so it leaves the pending queue.
        if stage:
            await move_job_to_stage(db, ev.saved_job_id, stage.id, user_id)

    ev.status = STATUS_APPLIED
    ev.applied_at = datetime.now(tz=UTC)
    await db.flush()
    return ev


async def dismiss_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Reject a pending event without moving anything (a wrong guess)."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status in (STATUS_APPLIED, STATUS_AUTO_APPLIED):
        raise HTTPException(
            status_code=409, detail="Event already applied; undo it instead"
        )
    ev.status = STATUS_DISMISSED
    await db.flush()
    return ev


async def undo_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Reverse an applied move: put the card back where it was, and mark the
    event dismissed so it doesn't nag again."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status not in (STATUS_APPLIED, STATUS_AUTO_APPLIED):
        raise HTTPException(status_code=409, detail="Nothing to undo")

    await move_job_to_stage(db, ev.saved_job_id, ev.previous_stage_id, user_id)
    ev.status = STATUS_DISMISSED
    ev.applied_at = None
    await db.flush()
    return ev
