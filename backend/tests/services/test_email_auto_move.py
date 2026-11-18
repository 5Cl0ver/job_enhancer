"""Automatic card moves: a scan moves a card by itself only when it is sure
which job an email is about — and every such move can be undone."""

import uuid

import pytest
from sqlalchemy import select

from app.models.detected_event import (
    STATUS_AUTO_APPLIED,
    STATUS_DISMISSED,
    STATUS_PENDING,
    DetectedEvent,
)
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services.email_review import auto_apply, list_pending, undo_event


async def _stage(db, user, name):
    return await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == user.id, PipelineStage.name == name
        )
    )


async def _job(db, user, stage_id):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title="Data Engineer",
        company="Vellacor",
        location="Remote",
        apply_url="https://example.com",
        content_hash=uuid.uuid4().hex,
        company_normalized="vellacor",
        title_normalized="data engineer",
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


async def _account(db, user):
    acct = EmailAccount(
        id=uuid.uuid4(),
        user_id=user.id,
        email_address="me@yahoo.com",
        provider="yahoo",
        imap_host="imap.mail.yahoo.com",
        imap_port=993,
        secret_encrypted="x",
    )
    db.add(acct)
    await db.flush()
    return acct


async def _event(db, user, acct, job, event_type, target, evidence, uid):
    ev = DetectedEvent(
        id=uuid.uuid4(),
        user_id=user.id,
        email_account_id=acct.id,
        saved_job_id=job.id,
        event_type=event_type,
        target_stage=target,
        from_addr="vellacor@myworkday.com",
        subject="An update on your application",
        message_uid=uid,
        previous_stage_id=job.pipeline_stage_id,
        match_evidence=evidence,
        status=STATUS_PENDING,
    )
    db.add(ev)
    await db.flush()
    return ev


@pytest.mark.asyncio
class TestAutoMove:
    async def test_sure_match_moves_the_card(self, db_session, test_user):
        applied = await _stage(db_session, test_user, "Applied")
        rejected = await _stage(db_session, test_user, "Rejected")
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, applied.id)
        ev = await _event(
            db_session, test_user, acct, job, "rejected", "Rejected", "template", "1"
        )

        moved = await auto_apply(db_session, test_user.id, [ev])

        assert moved == [ev]
        assert ev.status == STATUS_AUTO_APPLIED
        assert ev.previous_stage_id == applied.id
        await db_session.refresh(job)
        assert job.pipeline_stage_id == rejected.id
        # Still on the page, so it can be undone.
        assert ev in await list_pending(db_session, test_user.id)

    @pytest.mark.parametrize("evidence", ["job_url", "job_id", "template"])
    async def test_exact_evidence_moves(self, db_session, test_user, evidence):
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, None)
        ev = await _event(
            db_session, test_user, acct, job, "interview", "Interview", evidence, "2"
        )
        assert await auto_apply(db_session, test_user.id, [ev]) == [ev]

    @pytest.mark.parametrize(
        "evidence", ["company_title", "company_date", "known_sender", None]
    )
    async def test_looser_evidence_waits_for_a_click(
        self, db_session, test_user, evidence
    ):
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, None)
        ev = await _event(
            db_session, test_user, acct, job, "interview", "Interview", evidence, "3"
        )

        assert await auto_apply(db_session, test_user.id, [ev]) == []
        assert ev.status == STATUS_PENDING
        await db_session.refresh(job)
        assert job.pipeline_stage_id is None

    async def test_never_moves_backward(self, db_session, test_user):
        rejected = await _stage(db_session, test_user, "Rejected")
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, rejected.id)
        ev = await _event(
            db_session, test_user, acct, job, "interview", "Interview", "template", "4"
        )

        assert await auto_apply(db_session, test_user.id, [ev]) == []
        await db_session.refresh(job)
        assert job.pipeline_stage_id == rejected.id

    async def test_missing_stage_moves_nothing(self, db_session, test_user):
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, None)
        ev = await _event(
            db_session, test_user, acct, job, "offer", "Offer Call", "template", "5"
        )
        assert await auto_apply(db_session, test_user.id, [ev]) == []
        assert ev.status == STATUS_PENDING

    async def test_receipt_and_rejection_in_one_scan_end_at_rejected(
        self, db_session, test_user
    ):
        rejected = await _stage(db_session, test_user, "Rejected")
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, None)
        no = await _event(
            db_session, test_user, acct, job, "rejected", "Rejected", "template", "6"
        )
        got = await _event(
            db_session, test_user, acct, job, "applied", "Applied", "template", "7"
        )

        moved = await auto_apply(db_session, test_user.id, [no, got])

        assert moved == [got, no]
        await db_session.refresh(job)
        assert job.pipeline_stage_id == rejected.id

    async def test_undo_puts_the_card_back(self, db_session, test_user):
        applied = await _stage(db_session, test_user, "Applied")
        acct = await _account(db_session, test_user)
        job = await _job(db_session, test_user, applied.id)
        ev = await _event(
            db_session, test_user, acct, job, "interview", "Interview", "job_id", "8"
        )
        await auto_apply(db_session, test_user.id, [ev])

        out = await undo_event(db_session, test_user.id, ev.id)

        assert out.status == STATUS_DISMISSED
        await db_session.refresh(job)
        assert job.pipeline_stage_id == applied.id
        assert ev not in await list_pending(db_session, test_user.id)
