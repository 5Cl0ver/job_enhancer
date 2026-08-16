"""Tests for the scan orchestration — emails → pending DetectedEvents."""

import uuid

import pytest
from sqlalchemy import select

from app.models.detected_event import STATUS_PENDING, DetectedEvent
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services.email_scan import EmailMessage, detect_events


async def _make_saved_job(db, user, company, title, stage_id=None):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title=title,
        company=company,
        location="Remote",
        apply_url="https://example.com/apply",
        content_hash=uuid.uuid4().hex,
        company_normalized=company.lower(),
        title_normalized=title.lower(),
    )
    db.add(listing)
    await db.flush()
    sj = SavedJob(
        id=uuid.uuid4(),
        user_id=user.id,
        job_listing_id=listing.id,
        pipeline_stage_id=stage_id,
    )
    db.add(sj)
    await db.flush()
    return sj


async def _make_account(db, user):
    acct = EmailAccount(
        id=uuid.uuid4(),
        user_id=user.id,
        email_address="me@yahoo.com",
        provider="yahoo",
        imap_host="imap.mail.yahoo.com",
        imap_port=993,
        secret_encrypted="not-a-real-token",
    )
    db.add(acct)
    await db.flush()
    return acct


@pytest.mark.asyncio
class TestDetectEvents:
    async def test_rejection_creates_pending_event_with_undo_target(
        self, db_session, test_user
    ):
        stages = (
            await db_session.scalars(
                select(PipelineStage).where(PipelineStage.user_id == test_user.id)
            )
        ).all()
        applied_stage = next(s for s in stages if s.name == "Applied")
        job = await _make_saved_job(
            db_session,
            test_user,
            "Acme Corp",
            "Backend Engineer",
            stage_id=applied_stage.id,
        )
        acct = await _make_account(db_session, test_user)

        msgs = [
            EmailMessage(
                uid="101",
                from_addr="no-reply@acme.com",
                subject="Update on your application to Acme",
                body="Unfortunately we have decided to move forward with other "
                "candidates.",
            )
        ]
        created = await detect_events(db_session, acct, msgs)

        assert len(created) == 1
        ev = created[0]
        assert ev.event_type == "rejected"
        assert ev.target_stage == "Rejected"
        assert ev.saved_job_id == job.id
        assert ev.status == STATUS_PENDING
        # Undo target = where the card was before (Applied).
        assert ev.previous_stage_id == applied_stage.id

    async def test_unknown_email_is_ignored(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Acme Corp", "Backend Engineer")
        acct = await _make_account(db_session, test_user)
        msgs = [
            EmailMessage(
                uid="1",
                from_addr="no-reply@indeed.com",
                subject="Jobs you may like",
                body="Here are 10 new roles near you.",
            )
        ]
        assert await detect_events(db_session, acct, msgs) == []

    async def test_no_confident_job_match_is_skipped(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Acme Corp", "Backend Engineer")
        acct = await _make_account(db_session, test_user)
        # A real rejection, but for a company the user never saved.
        msgs = [
            EmailMessage(
                uid="2",
                from_addr="no-reply@umbrella-corp.com",
                subject="Your application",
                body="Unfortunately we won't be moving forward.",
            )
        ]
        assert await detect_events(db_session, acct, msgs) == []

    async def test_rescan_does_not_duplicate(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Globex", "Frontend Developer")
        acct = await _make_account(db_session, test_user)
        msgs = [
            EmailMessage(
                uid="55",
                from_addr="talent@globex.com",
                subject="Interview with Globex — Frontend Developer",
                body="We'd like to schedule a call. What's your availability?",
            )
        ]
        first = await detect_events(db_session, acct, msgs)
        assert len(first) == 1
        # Same message again → no new event (deduped by UID).
        second = await detect_events(db_session, acct, msgs)
        assert second == []
        total = (
            await db_session.scalars(
                select(DetectedEvent).where(DetectedEvent.email_account_id == acct.id)
            )
        ).all()
        assert len(total) == 1
