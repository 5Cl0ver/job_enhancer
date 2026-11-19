"""API tests for the navigation badge counts."""

import uuid

import pytest
from httpx import AsyncClient

from app.models.detected_event import (
    STATUS_AUTO_APPLIED,
    STATUS_DISMISSED,
    STATUS_HIDDEN,
    STATUS_PENDING,
    STATUS_REVIEW,
    DetectedEvent,
)
from app.models.email_account import EmailAccount
from app.models.user import User


async def _account(db, user):
    acct = EmailAccount(
        id=uuid.uuid4(),
        user_id=user.id,
        email_address=f"{uuid.uuid4().hex[:6]}@yahoo.com",
        provider="yahoo",
        imap_host="imap.mail.yahoo.com",
        imap_port=993,
        secret_encrypted="x",
    )
    db.add(acct)
    await db.flush()
    return acct


async def _event(db, user, acct, event_type, status):
    db.add(
        DetectedEvent(
            id=uuid.uuid4(),
            user_id=user.id,
            email_account_id=acct.id,
            event_type=event_type,
            from_addr="talent@vellacor.example",
            subject="About your application",
            message_uid=uuid.uuid4().hex,
            status=status,
        )
    )
    await db.flush()


@pytest.mark.asyncio
class TestAttention:
    async def test_nothing_waiting(self, client: AsyncClient):
        r = await client.get("/v1/attention")
        assert r.status_code == 200, r.text
        assert r.json() == {"tasks_open": 0, "tasks_overdue": 0, "email_review": 0}

    async def test_counts_only_updates_that_need_the_user(
        self, client: AsyncClient, db_session, test_user
    ):
        acct = await _account(db_session, test_user)
        # Waiting: an important update to click, and one whose job is unclear.
        await _event(db_session, test_user, acct, "interview", STATUS_PENDING)
        await _event(db_session, test_user, acct, "rejected", STATUS_REVIEW)
        # Not waiting: a plain confirmation, and anything already dealt with.
        await _event(db_session, test_user, acct, "applied", STATUS_PENDING)
        await _event(db_session, test_user, acct, "offer", STATUS_AUTO_APPLIED)
        await _event(db_session, test_user, acct, "rejected", STATUS_DISMISSED)
        await _event(db_session, test_user, acct, "interview", STATUS_HIDDEN)

        assert (await client.get("/v1/attention")).json()["email_review"] == 2

    async def test_other_peoples_updates_are_not_counted(
        self, client: AsyncClient, db_session
    ):
        other = User(id=uuid.uuid4(), email="other@test.dev")
        db_session.add(other)
        await db_session.flush()
        acct = await _account(db_session, other)
        await _event(db_session, other, acct, "interview", STATUS_PENDING)

        assert (await client.get("/v1/attention")).json()["email_review"] == 0
