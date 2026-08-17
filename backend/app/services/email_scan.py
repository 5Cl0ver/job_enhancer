"""Turn fetched emails into reviewable pipeline updates ("detected events").

The orchestration layer between the raw inbox (IMAP I/O lives elsewhere) and the
tracker. Kept free of I/O so it's fully unit-testable: hand it a list of
:class:`EmailMessage` and it classifies + matches each against the user's saved
jobs, recording a *pending* ``DetectedEvent`` for every confident hit. Nothing
is moved here — approving/undoing is a separate, user-driven step. Conservative
by design: unknown emails and low-confidence matches are dropped, never guessed.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import quote

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

logger = logging.getLogger("app.email_scan")


@dataclass
class EmailMessage:
    """A fetched email, normalized to just what the classifier/matcher need."""

    uid: str
    from_addr: str
    subject: str
    body: str
    date: datetime | None = None
    message_id: str = ""  # RFC822 Message-ID header, for deep-linking (Gmail)


@dataclass
class Considered:
    """A near-miss the scan looked at but did NOT surface — for transparency.

    Either a card-moving signal we couldn't confidently match to a saved job, or
    a matched recruiter contact we deliberately don't surface. Spam (UNKNOWN with
    no match) is excluded — it's noise, not a decision worth showing.
    """

    from_addr: str
    subject: str
    event_type: str
    reason: str  # "no_confident_match" | "filtered_contact"
    matched_company: str | None = None
    matched_title: str | None = None
    mail_link: str | None = None
    date: datetime | None = None


@dataclass
class DetectResult:
    """Outcome of a scan: surfaced updates plus the near-misses we skipped."""

    created: list[DetectedEvent] = field(default_factory=list)
    considered: list[Considered] = field(default_factory=list)


# Cap the transparency list so a huge inbox can't return an unbounded payload.
_MAX_CONSIDERED = 40


def mail_link(provider: str, message_id: str) -> str | None:
    """A deep link that opens this exact message in the user's webmail.

    Only Gmail exposes a stable per-message URL (search by RFC822 Message-ID).
    Yahoo/others have no reliable public link, so we return None and the UI shows
    sender/subject/date instead.
    """
    mid = (message_id or "").strip().strip("<>")
    if not mid:
        return None
    if provider in ("gmail",):
        return f"https://mail.google.com/mail/u/0/#search/rfc822msgid:{quote(mid)}"
    return None


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
) -> DetectResult:
    """Classify + match each message; record new pending DetectedEvents.

    Returns a :class:`DetectResult` with the surfaced ``created`` events plus the
    ``considered`` near-misses (for the "what else I looked at" transparency
    view). Messages already seen (by UID) and pure spam (``UNKNOWN`` with no
    match) are skipped silently.
    """
    seen_uids = set(
        await db.scalars(
            select(DetectedEvent.message_uid).where(
                DetectedEvent.email_account_id == account.id
            )
        )
    )
    jobs = await _candidate_jobs(db, account.user_id)
    result = DetectResult()

    for msg in messages:
        if not msg.uid or msg.uid in seen_uids:
            continue
        event_type = classify_email(msg.subject, msg.body, msg.from_addr)
        if event_type == UNKNOWN:
            continue  # spam / no job signal — pure noise, not worth reporting
        seen_uids.add(msg.uid)

        job = match_email_to_job(
            jobs,
            company_hint=company_from_sender(msg.from_addr),
            subject=msg.subject,
        )
        target_stage = stage_for_event(event_type)

        # Only a card-moving signal WITH a confident match becomes a surfaced,
        # reviewable update. Everything else that got a job signal is a near-miss
        # we record for transparency (capped) but never act on.
        if target_stage is not None and job:
            event = DetectedEvent(
                id=uuid.uuid4(),
                user_id=account.user_id,
                email_account_id=account.id,
                saved_job_id=job["id"],
                event_type=event_type,
                target_stage=target_stage,
                from_addr=(msg.from_addr or "")[:255],
                subject=(msg.subject or "")[:500],
                message_uid=msg.uid,
                previous_stage_id=job.get("pipeline_stage_id"),
                status=STATUS_PENDING,
            )
            db.add(event)
            result.created.append(event)
        elif len(result.considered) < _MAX_CONSIDERED:
            # A matched contact we don't surface, or a signal with no confident
            # match — the two "false positive / near miss" buckets to show.
            reason = "filtered_contact" if job else "no_confident_match"
            result.considered.append(
                Considered(
                    from_addr=(msg.from_addr or "")[:255],
                    subject=(msg.subject or "")[:500],
                    event_type=event_type,
                    reason=reason,
                    matched_company=job["company"] if job else None,
                    matched_title=job["title"] if job else None,
                    mail_link=mail_link(account.provider, msg.message_id),
                    date=msg.date,
                )
            )

    await db.flush()
    logger.info(
        "email scan: %d messages, %d candidate jobs → %d new, %d considered",
        len(messages),
        len(jobs),
        len(result.created),
        len(result.considered),
    )
    for ev in result.created:
        logger.info(
            "  detected %s → %s (job=%s) subj=%r",
            ev.event_type,
            ev.target_stage,
            ev.saved_job_id,
            ev.subject[:60],
        )
    return result
