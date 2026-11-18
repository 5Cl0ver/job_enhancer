"""Review actions for detected email events — resolve, approve, dismiss, undo.

The user-driven half of email auto-status. Detection only ever writes a PENDING
event; the actual card move happens *here*, when the user approves it — and is
reversed here when they undo. With auto-move on, a scan moves the cards it is
sure about here too (``auto_apply``); those stay visible, each with an undo.
A NEEDS_REVIEW item (unclear job, or unsure what the email says) waits until
the user picks the job — and, for an unsure email, the type — which turns it
into an ordinary pending update. Every action is
scoped to the owning user, and the event's ``status`` is left as the durable
record of what happened.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import (
    OPEN_STATUSES,
    STATUS_APPLIED,
    STATUS_AUTO_APPLIED,
    STATUS_CONTACT,
    STATUS_DISMISSED,
    STATUS_HIDDEN,
    STATUS_PENDING,
    STATUS_REVIEW,
    STATUS_UNSAVED,
    DetectedEvent,
)
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.schemas.saved_job import ManualJobCreate
from app.services.email_classify import (
    APPLIED,
    ASSESSMENT,
    INTERVIEW,
    OFFER,
    REJECTED,
    UNSURE,
    stage_for_event,
)
from app.services.email_match import JOB_ID, JOB_URL, TEMPLATE
from app.services.email_scan import _stage_orders, card_action, mail_link
from app.services.saved_jobs import save_manual_job
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


# Evidence that names the job exactly: its link, its job ID, or a hiring
# site's own template naming the company and role. Only these move a card
# without a click; anything looser waits for the user.
SURE_EVIDENCE = (JOB_URL, JOB_ID, TEMPLATE)
AUTO_EVENTS = (APPLIED, INTERVIEW, ASSESSMENT, OFFER, REJECTED)
# How long the "Moved for you" list keeps an automatic move on the page.
MOVED_SHOWN_DAYS = 30


async def list_pending(db: AsyncSession, user_id: uuid.UUID) -> list[DetectedEvent]:
    """Events awaiting the user — pending updates, questions and hidden
    low-value items — plus recent automatic moves (so each can be undone),
    newest first. Uncapped: open items stay until acted on."""
    since = datetime.now(tz=UTC) - timedelta(days=MOVED_SHOWN_DAYS)
    rows = await db.scalars(
        select(DetectedEvent)
        .where(
            DetectedEvent.user_id == user_id,
            or_(
                DetectedEvent.status.in_(OPEN_STATUSES),
                and_(
                    DetectedEvent.status == STATUS_AUTO_APPLIED,
                    DetectedEvent.applied_at >= since,
                ),
            ),
        )
        .order_by(DetectedEvent.created_at.desc())
    )
    return list(rows)


async def auto_apply(
    db: AsyncSession, user_id: uuid.UUID, events: list[DetectedEvent]
) -> list[DetectedEvent]:
    """Move the cards a scan is sure about, without a click.

    Only a pending update whose job was matched on exact evidence moves, only
    forward in the user's own stage order, and only to a stage that exists.
    Each move records where the card was, so Undo puts it back. Everything
    else stays pending for the user."""
    stages = {
        s.name: s
        for s in await db.scalars(
            select(PipelineStage).where(PipelineStage.user_id == user_id)
        )
    }
    order_of = {s.id: s.sort_order for s in stages.values()}
    sure = [
        ev
        for ev in events
        if ev.status == STATUS_PENDING
        and ev.saved_job_id is not None
        and ev.match_evidence in SURE_EVIDENCE
        and ev.event_type in AUTO_EVENTS
        and ev.target_stage in stages
    ]
    # Earlier stages first: an application receipt and a rejection for the
    # same job in one scan end with the card at Rejected, not Applied.
    sure.sort(key=lambda ev: stages[ev.target_stage].sort_order)
    moved = []
    for ev in sure:
        job = await db.get(SavedJob, ev.saved_job_id)
        if job is None or job.user_id != user_id:
            continue
        stage = stages[ev.target_stage]
        current = order_of.get(job.pipeline_stage_id)
        if current is not None and stage.sort_order <= current:
            continue  # already there or further on: leave it for the user
        ev.previous_stage_id = job.pipeline_stage_id
        await move_job_to_stage(db, job.id, stage.id, user_id)
        ev.status = STATUS_AUTO_APPLIED
        ev.applied_at = datetime.now(tz=UTC)
        moved.append(ev)
    await db.flush()
    return moved


async def apply_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Approve a pending event: move the card to the target stage (if any) and
    mark it applied. A recruiter contact has no target stage — it just logs.

    If the user has deleted the target stage, nothing is moved and the event
    stays pending: a 409 says so plainly instead of reporting a normal move.
    The user can re-create the stage, or dismiss the update."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status == STATUS_REVIEW:
        raise HTTPException(
            status_code=409, detail="Choose which job this email is about first"
        )
    if ev.status == STATUS_HIDDEN:
        raise HTTPException(
            status_code=409, detail="This email isn't a clear update; nothing to apply"
        )
    if ev.status in (STATUS_UNSAVED, STATUS_CONTACT):
        raise HTTPException(
            status_code=409,
            detail="This email isn't about one of your saved jobs; nothing to apply",
        )
    if ev.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Event already reviewed")

    if ev.target_stage:
        stage = await db.scalar(
            select(PipelineStage).where(
                PipelineStage.user_id == user_id,
                PipelineStage.name == ev.target_stage,
            )
        )
        if stage is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"The \u201c{ev.target_stage}\u201d stage no longer exists, so "
                    "this card can't be moved. Re-create the stage, or dismiss "
                    "this update."
                ),
            )
        await move_job_to_stage(db, ev.saved_job_id, stage.id, user_id)

    ev.status = STATUS_APPLIED
    ev.applied_at = datetime.now(tz=UTC)
    await db.flush()
    return ev


async def resolve_event(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    saved_job_id: uuid.UUID,
    event_type: str | None = None,
) -> DetectedEvent:
    """The user says which saved job a needs-review email is about (and, for
    an unsure email, what it says). The item becomes a pending update; nothing
    moves until they approve it. Any of the user's active saved jobs may be
    chosen, not only the scan's candidates — the candidates are suggestions."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status != STATUS_REVIEW:
        raise HTTPException(status_code=409, detail="This item doesn't need review")

    kind = ev.event_type
    if event_type is not None:
        kind = event_type
    if kind == UNSURE:
        raise HTTPException(
            status_code=422, detail="Choose what the email says before the job"
        )
    if event_type is not None and stage_for_event(event_type) is None:
        raise HTTPException(
            status_code=422, detail="Pick an update type that moves a card"
        )

    job = await db.scalar(
        select(SavedJob).where(
            SavedJob.id == saved_job_id,
            SavedJob.user_id == user_id,
            SavedJob.is_archived.is_(False),
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Saved job not found")
    # Same forward-only rule as the scan: never set up a backward move.
    by_name, by_id = await _stage_orders(db, user_id)
    _, why = card_action(
        stage_for_event(kind),
        by_name,
        current_order=by_id.get(job.pipeline_stage_id),
        reminder=False,
    )
    if why == "already_at_or_past_stage":
        raise HTTPException(
            status_code=409,
            detail=(
                "That card is already at or past this stage; dismiss this item instead"
            ),
        )

    ev.saved_job_id = job.id
    ev.event_type = kind
    ev.target_stage = stage_for_event(kind)
    ev.previous_stage_id = job.pipeline_stage_id
    ev.status = STATUS_PENDING
    await db.flush()
    return ev


async def track_event(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    company: str,
    title: str,
    provider: str = "",
) -> DetectedEvent:
    """Add the job an unsaved important update is about to the user's tracker
    (the user's click), with its card in the stage the email describes."""
    ev = await _get_event(db, user_id, event_id)
    if ev.status != STATUS_UNSAVED:
        raise HTTPException(status_code=409, detail="This item can't be added")
    url = mail_link(provider, subject=ev.subject) or "https://mail.yahoo.com/"
    sj = await save_manual_job(
        db, user_id, ManualJobCreate(url=url, title=title, company=company)
    )
    previous = sj.pipeline_stage_id
    if ev.target_stage:
        stage = await db.scalar(
            select(PipelineStage).where(
                PipelineStage.user_id == user_id,
                PipelineStage.name == ev.target_stage,
            )
        )
        if stage is not None:
            await move_job_to_stage(db, sj.id, stage.id, user_id)
    ev.saved_job_id = sj.id
    ev.previous_stage_id = previous
    ev.job_company, ev.job_title = company[:255], title[:255]
    ev.status = STATUS_APPLIED
    ev.applied_at = datetime.now(tz=UTC)
    await db.flush()
    return ev


async def dismiss_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    """Reject a pending event or a needs-review item without moving anything
    (a wrong guess, or an email that isn't about any saved job)."""
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
