"""Turn fetched emails into reviewable pipeline updates ("detected events").

The orchestration layer between the raw inbox (IMAP I/O lives elsewhere) and the
tracker. Kept free of I/O so it's fully unit-testable: hand it a list of
:class:`EmailMessage` and it classifies + matches each against the user's saved
jobs, recording a *pending* ``DetectedEvent`` for every confident hit. Nothing
is moved here — approving/undoing is a separate, user-driven step. Conservative
by design: unknown emails and low-confidence matches are dropped, never guessed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import STATUS_PENDING, DetectedEvent
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.services.email_classify import (
    UNKNOWN,
    classify_email,
    company_from_sender,
    match_email_to_job,
    stage_for_event,
)


@dataclass
class EmailMessage:
    """A fetched email, normalized to just what the classifier/matcher need."""

    uid: str
    from_addr: str
    subject: str
    body: str
    date: datetime | None = None


async def _candidate_jobs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's active saved jobs as match candidates (id + stage + names)."""
    rows = (
        await db.execute(
            select(
                SavedJob.id,
                SavedJob.pipeline_stage_id,
                JobListing.company,
                JobListing.title,
            )
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .where(
                SavedJob.user_id == user_id,
                SavedJob.is_archived.is_(False),
            )
        )
    ).all()
    return [
        {
            "id": r.id,
            "pipeline_stage_id": r.pipeline_stage_id,
            "company": r.company,
            "title": r.title,
        }
        for r in rows
    ]


async def detect_events(
    db: AsyncSession,
    account: EmailAccount,
    messages: list[EmailMessage],
) -> list[DetectedEvent]:
    """Classify + match each message, recording new pending DetectedEvents.

    Skips messages we've already seen (by IMAP UID), messages the classifier
    can't read (``UNKNOWN``), and messages we can't confidently tie to a saved
    job. Returns only the events created this call.
    """
    seen_uids = set(
        await db.scalars(
            select(DetectedEvent.message_uid).where(
                DetectedEvent.email_account_id == account.id
            )
        )
    )
    jobs = await _candidate_jobs(db, account.user_id)
    created: list[DetectedEvent] = []

    for msg in messages:
        if not msg.uid or msg.uid in seen_uids:
            continue
        event_type = classify_email(msg.subject, msg.body, msg.from_addr)
        if event_type == UNKNOWN:
            continue
        job = match_email_to_job(
            jobs,
            company_hint=company_from_sender(msg.from_addr),
            subject=msg.subject,
        )
        if not job:
            continue
        event = DetectedEvent(
            id=uuid.uuid4(),
            user_id=account.user_id,
            email_account_id=account.id,
            saved_job_id=job["id"],
            event_type=event_type,
            target_stage=stage_for_event(event_type),
            from_addr=(msg.from_addr or "")[:255],
            subject=(msg.subject or "")[:500],
            message_uid=msg.uid,
            previous_stage_id=job.get("pipeline_stage_id"),
            status=STATUS_PENDING,
        )
        db.add(event)
        created.append(event)
        seen_uids.add(msg.uid)

    await db.flush()
    return created
