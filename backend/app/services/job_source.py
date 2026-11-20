"""Where a saved job came from: its folder, and the Claude Scout search or the
email that put it in My Jobs. Read-only; one small answer for the job page.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.detected_event import DetectedEvent
from app.models.saved_job import ORIGIN_EMAIL, SavedJob
from app.models.scout import SAVED, ScoutFinding, ScoutRun
from app.schemas.saved_job import (
    JobSourceOut,
    SourceEmail,
    SourceFolder,
    SourceScout,
)
from app.services.email_accounts import get_account
from app.services.email_scan import email_id_of, mail_link, mail_search_link


async def _scout(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID
) -> SourceScout | None:
    row = (
        await db.execute(
            select(ScoutFinding, ScoutRun.criteria)
            .join(ScoutRun, ScoutRun.id == ScoutFinding.run_id)
            .where(
                ScoutFinding.user_id == user_id,
                ScoutFinding.saved_job_id == saved_job_id,
                ScoutFinding.outcome == SAVED,
            )
            .order_by(ScoutFinding.created_at.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    finding, criteria = row
    return SourceScout(
        run_id=finding.run_id,
        finding_id=finding.id,
        source=finding.source,
        search_name=(criteria or {}).get("name", ""),
        fit_score=finding.fit_score,
        why_fit=finding.why_fit,
        gaps=finding.gaps,
        found_at=finding.created_at,
    )


async def _email(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID
) -> SourceEmail | None:
    """The email the job was made from: the first one the user added it from."""
    ev = await db.scalar(
        select(DetectedEvent)
        .where(
            DetectedEvent.user_id == user_id,
            DetectedEvent.saved_job_id == saved_job_id,
        )
        .order_by(
            DetectedEvent.applied_at.is_(None),
            DetectedEvent.applied_at,
            DetectedEvent.created_at,
        )
        .limit(1)
    )
    if ev is None:
        return None
    account = await get_account(db, user_id)
    provider = account.provider if account else ""
    return SourceEmail(
        event_id=ev.id,
        event_type=ev.event_type,
        email_date=ev.email_date,
        mail_link=mail_link(
            provider,
            subject=ev.subject,
            email_id=email_id_of(ev.logical_key),
            folder=ev.folder,
            from_addr=ev.from_addr,
        ),
        mail_search_link=mail_search_link(provider, ev.subject, ev.from_addr),
    )


async def job_source(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID
) -> JobSourceOut:
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise HTTPException(status_code=404, detail="Saved job not found")
    folder = None
    if sj.collection_id:
        name = await db.scalar(
            select(Collection.name).where(
                Collection.id == sj.collection_id, Collection.user_id == user_id
            )
        )
        if name is not None:
            folder = SourceFolder(id=sj.collection_id, name=name)
    return JobSourceOut(
        origin=sj.origin,
        saved_at=sj.created_at,
        collection=folder,
        scout=await _scout(db, user_id, sj.id),
        email=await _email(db, user_id, sj.id) if sj.origin == ORIGIN_EMAIL else None,
    )
