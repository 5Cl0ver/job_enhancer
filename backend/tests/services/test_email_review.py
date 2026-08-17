"""Tests for the review actions — approve / dismiss / undo a detected event."""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.detected_event import (
    STATUS_APPLIED,
    STATUS_DISMISSED,
    STATUS_PENDING,
    DetectedEvent,
)
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services.email_review import (
    apply_event,
    dismiss_event,
    list_pending,
    undo_event,
)


async def _stage(db, user, name):
    return await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == user.id, PipelineStage.name == name
        )
    )


async def _saved_job(db, user, stage_id):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title="Backend Engineer",
        company="Acme",
        location="Remote",
        apply_url="https://example.com",
        content_hash=uuid.uuid4().hex,
        company_normalized="acme",
        title_normalized="backend engineer",
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


async def _event(db, user, saved_job, target_stage, prev_stage_id):
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
    ev = DetectedEvent(
        id=uuid.uuid4(),
        user_id=user.id,
        email_account_id=acct.id,
        saved_job_id=saved_job.id,
        event_type="interview",
        target_stage=target_stage,
        from_addr="talent@acme.com",
        subject="Interview with Acme",
        message_uid="900",
        previous_stage_id=prev_stage_id,
        status=STATUS_PENDING,
    )
    db.add(ev)
    await db.flush()
    return ev


@pytest.mark.asyncio
class TestReview:
    async def test_apply_moves_card_and_records(self, db_session, test_user):
        saved = await _stage(db_session, test_user, "Interested")
        interview = await _stage(db_session, test_user, "Interview")
        job = await _saved_job(db_session, test_user, saved.id)
        ev = await _event(db_session, test_user, job, "Interview", saved.id)

        out = await apply_event(db_session, test_user.id, ev.id)

        assert out.status == STATUS_APPLIED
        assert out.applied_at is not None
        await db_session.refresh(job)
        assert job.pipeline_stage_id == interview.id
        # No longer in the pending queue.
        assert await list_pending(db_session, test_user.id) == []

    async def test_undo_restores_previous_stage(self, db_session, test_user):
        saved = await _stage(db_session, test_user, "Interested")
        job = await _saved_job(db_session, test_user, saved.id)
        ev = await _event(db_session, test_user, job, "Interview", saved.id)

        await apply_event(db_session, test_user.id, ev.id)
        out = await undo_event(db_session, test_user.id, ev.id)

        assert out.status == STATUS_DISMISSED
        await db_session.refresh(job)
        assert job.pipeline_stage_id == saved.id  # back where it started

    async def test_dismiss_moves_nothing(self, db_session, test_user):
        saved = await _stage(db_session, test_user, "Interested")
        job = await _saved_job(db_session, test_user, saved.id)
        ev = await _event(db_session, test_user, job, "Interview", saved.id)

        out = await dismiss_event(db_session, test_user.id, ev.id)

        assert out.status == STATUS_DISMISSED
        await db_session.refresh(job)
        assert job.pipeline_stage_id == saved.id  # untouched

    async def test_apply_twice_conflicts(self, db_session, test_user):
        saved = await _stage(db_session, test_user, "Interested")
        job = await _saved_job(db_session, test_user, saved.id)
        ev = await _event(db_session, test_user, job, "Interview", saved.id)

        await apply_event(db_session, test_user.id, ev.id)
        with pytest.raises(HTTPException) as exc:
            await apply_event(db_session, test_user.id, ev.id)
        assert exc.value.status_code == 409

    async def test_unknown_event_is_404(self, db_session, test_user):
        with pytest.raises(HTTPException) as exc:
            await apply_event(db_session, test_user.id, uuid.uuid4())
        assert exc.value.status_code == 404

    async def test_cannot_undo_a_pending_event(self, db_session, test_user):
        saved = await _stage(db_session, test_user, "Interested")
        job = await _saved_job(db_session, test_user, saved.id)
        ev = await _event(db_session, test_user, job, "Interview", saved.id)
        with pytest.raises(HTTPException) as exc:
            await undo_event(db_session, test_user.id, ev.id)
        assert exc.value.status_code == 409
