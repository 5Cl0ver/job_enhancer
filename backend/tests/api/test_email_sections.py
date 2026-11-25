"""New emails on your jobs, seen, the board's dot, and "Looked at, not shown"
with "This is about my job" (spec 027 part B)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.services.users import create_user
from tests.api.test_email import _create_saved_job


@pytest.fixture
def enc_key(monkeypatch):
    from cryptography.fernet import Fernet

    from app.config import settings

    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


async def _setup(client, db_session, test_user):
    r = await client.post(
        "/v1/email/connect",
        json={"email_address": "me@yahoo.com", "app_password": "pw"},
    )
    assert r.status_code == 201
    account = await db_session.scalar(select(EmailAccount))
    job = await _create_saved_job(
        db_session, test_user, "Brightwave Relays", "IT Systems Engineer"
    )
    return account, job


def _row(account, user, status, *, job=None, days=0, **kw):
    return DetectedEvent(
        id=uuid.uuid4(),
        user_id=user.id,
        email_account_id=account.id,
        saved_job_id=job.id if job else None,
        from_addr="Brightwave Relays <careers@brightwaverelays.example>",
        subject=kw.pop("subject", "An email"),
        folder="INBOX",
        uidvalidity=1,
        message_uid=uuid.uuid4().hex[:8],
        event_type=kw.pop("event_type", "interview"),
        status=status,
        created_at=datetime.now(tz=UTC) - timedelta(days=days),
        **kw,
    )


@pytest.mark.asyncio
async def test_new_emails_on_your_jobs_until_seen(
    client, db_session, test_user, enc_key
):
    account, job = await _setup(client, db_session, test_user)
    db_session.add_all(
        [
            _row(account, test_user, "noted", job=job, subject="Second interview"),
            _row(account, test_user, "noted", job=job, days=20, subject="Old one"),
            _row(account, test_user, "pending", job=job, subject="Waiting"),
        ]
    )
    await db_session.commit()

    new = (await client.get("/v1/email/new")).json()
    assert [e["subject"] for e in new] == ["Second interview"]
    assert new[0]["job_listing_id"] == str(job.job_listing_id)
    assert new[0]["company"] == "Brightwave Relays"
    dots = (await client.get("/v1/email/job-emails/unseen")).json()
    # The 20-day-old one is past the 14 days: not counted.
    assert dots == [{"saved_job_id": str(job.id), "count": 1}]

    # Opening the job sees them.
    r = await client.post(
        "/v1/email/job-emails/seen", json={"job_listing_id": str(job.job_listing_id)}
    )
    assert r.status_code == 204
    assert (await client.get("/v1/email/new")).json() == []
    assert (await client.get("/v1/email/job-emails/unseen")).json() == []
    on_job = (
        await client.get(
            "/v1/email/job-emails", params={"job_listing_id": str(job.job_listing_id)}
        )
    ).json()
    assert all(e["seen_at"] for e in on_job if e["status"] == "noted")


@pytest.mark.asyncio
async def test_looked_at_and_this_is_about_my_job(
    client, db_session, test_user, enc_key
):
    account, job = await _setup(client, db_session, test_user)
    skipped = _row(
        account,
        test_user,
        "skipped",
        subject="Jobs picked for you",
        event_type="applied",
        skip_reason="digest",
    )
    db_session.add(skipped)
    await db_session.commit()

    looked = (await client.get("/v1/email/looked-at")).json()
    assert [(e["subject"], e["skip_reason"]) for e in looked] == [
        ("Jobs picked for you", "digest")
    ]
    # Never on the pending list.
    assert (await client.get("/v1/email/events")).json() == []

    other = await create_user(db_session, email="other@test.dev", name="Other")
    theirs = await _create_saved_job(db_session, other, "Elsewhere", "Engineer")
    await db_session.commit()
    url = f"/v1/email/events/{skipped.id}/keep"
    assert (
        await client.post(url, json={"saved_job_id": str(theirs.id)})
    ).status_code == 404

    kept = await client.post(url, json={"saved_job_id": str(job.id)})
    assert kept.status_code == 200, kept.text
    body = kept.json()
    assert (body["status"], body["saved_job_id"]) == ("noted", str(job.id))
    assert body["skip_reason"] is None
    assert (await client.get("/v1/email/looked-at")).json() == []
    # Sorted once.
    assert (
        await client.post(url, json={"saved_job_id": str(job.id)})
    ).status_code == 409
    on_job = (
        await client.get(
            "/v1/email/job-emails", params={"job_listing_id": str(job.job_listing_id)}
        )
    ).json()
    assert [e["subject"] for e in on_job] == ["Jobs picked for you"]
