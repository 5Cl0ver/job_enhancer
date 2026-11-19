"""Opening the email behind an update, and listing a job's emails.

Synthetic: the IMAP fetch is replaced by a fake that hands back a made-up
message, so no mailbox is touched.
"""

import uuid

import pytest

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.models.user import User
from app.services import email_sync
from tests.api.test_email import _create_saved_job
from tests.fake_imap import make_raw


async def _connect(client):
    r = await client.post(
        "/v1/email/connect",
        json={"email_address": "me@yahoo.com", "app_password": "pw"},
    )
    assert r.status_code == 201


async def _account(db, user):
    from sqlalchemy import select

    return await db.scalar(select(EmailAccount).where(EmailAccount.user_id == user.id))


async def _event(db, user, account, saved_job=None, uid="77", uidvalidity=5, **kw):
    ev = DetectedEvent(
        id=uuid.uuid4(),
        user_id=user.id,
        email_account_id=account.id,
        saved_job_id=saved_job.id if saved_job else None,
        event_type="rejected",
        target_stage="Rejected",
        from_addr=kw.pop("from_addr", "Talent <talent@vellacor.example>"),
        subject=kw.pop("subject", "Your application"),
        folder="INBOX",
        uidvalidity=uidvalidity,
        message_uid=uid,
        status=kw.pop("status", "pending"),
        **kw,
    )
    db.add(ev)
    await db.flush()
    return ev


@pytest.fixture
def enc_key(monkeypatch):
    """A real encryption key so /connect is enabled during tests."""
    from cryptography.fernet import Fernet

    from app.config import settings

    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


@pytest.fixture
def fake_mailbox(monkeypatch):
    calls = []

    def fetch_refs(host, port, addr, pw, refs, on_message, **kw):
        calls.append(refs)
        for r in refs:
            if r.uid == 404:
                on_message(r, None, "vanished")
            else:
                raw = make_raw(
                    "Your application to Vellacor",
                    body="<b>Hi</b> — unfortunately we will not move forward.",
                )
                on_message(r, raw, "")

    monkeypatch.setattr(email_sync, "fetch_refs", fetch_refs)
    return calls


@pytest.mark.asyncio
class TestViewEmail:
    async def test_opens_the_email_as_plain_text(
        self,
        client,
        db_session,
        test_user,
        enc_key,
        fake_mailbox,
    ):
        await _connect(client)
        ev = await _event(db_session, test_user, await _account(db_session, test_user))
        r = await client.get(f"/v1/email/events/{ev.id}/message")
        assert r.status_code == 200
        body = r.json()
        assert body["subject"] == "Your application to Vellacor"
        assert "will not move forward" in body["text"]
        assert body["mail_link"]
        (refs,) = fake_mailbox
        assert (refs[0].folder, refs[0].uidvalidity, refs[0].uid) == ("INBOX", 5, 77)

    async def test_gone_email_is_a_clear_404(
        self,
        client,
        db_session,
        test_user,
        enc_key,
        fake_mailbox,
    ):
        await _connect(client)
        ev = await _event(
            db_session, test_user, await _account(db_session, test_user), uid="404"
        )
        r = await client.get(f"/v1/email/events/{ev.id}/message")
        assert r.status_code == 404 and "no longer" in r.json()["detail"]

    async def test_older_row_opens_when_it_is_the_same_email(
        self,
        client,
        db_session,
        test_user,
        enc_key,
        fake_mailbox,
    ):
        """A row saved before folders were tracked has no UIDVALIDITY: read the
        UID as it is now, and show it only if subject and sender still match."""
        await _connect(client)
        ev = await _event(
            db_session,
            test_user,
            await _account(db_session, test_user),
            uidvalidity=None,
            subject="Your application to Vellacor",
            from_addr="Brambleworks Careers <careers@brambleworks.example>",
        )
        r = await client.get(f"/v1/email/events/{ev.id}/message")
        assert r.status_code == 200
        (refs,) = fake_mailbox
        assert (refs[0].uidvalidity, refs[0].uid) == (None, 77)

    async def test_older_row_whose_uid_now_names_another_email_is_404(
        self,
        client,
        db_session,
        test_user,
        enc_key,
        fake_mailbox,
    ):
        await _connect(client)
        ev = await _event(
            db_session,
            test_user,
            await _account(db_session, test_user),
            uidvalidity=None,
            subject="A different email",
        )
        r = await client.get(f"/v1/email/events/{ev.id}/message")
        assert r.status_code == 404 and "no longer" in r.json()["detail"]

    async def test_someone_elses_event_is_not_found(
        self,
        client,
        db_session,
        test_user,
        enc_key,
        fake_mailbox,
    ):
        await _connect(client)
        other = User(id=uuid.uuid4(), email="other@test.dev")
        db_session.add(other)
        await db_session.flush()
        acct = EmailAccount(
            id=uuid.uuid4(),
            user_id=other.id,
            email_address="o@yahoo.com",
            provider="yahoo",
            imap_host="imap.example",
            imap_port=993,
            secret_encrypted="x",
        )
        db_session.add(acct)
        await db_session.flush()
        ev = await _event(db_session, other, acct)
        r = await client.get(f"/v1/email/events/{ev.id}/message")
        assert r.status_code == 404 and fake_mailbox == []


@pytest.mark.asyncio
class TestJobEmails:
    async def test_lists_only_that_jobs_emails(
        self,
        client,
        db_session,
        test_user,
        enc_key,
    ):
        await _connect(client)
        acct = await _account(db_session, test_user)
        job = await _create_saved_job(
            db_session, test_user, "Vellacor", "Data Engineer"
        )
        other = await _create_saved_job(
            db_session, test_user, "Tidelock", "Platform Engineer"
        )
        mine = await _event(db_session, test_user, acct, job, uid="1")
        await _event(db_session, test_user, acct, other, uid="2")
        await _event(db_session, test_user, acct, job, uid="3", status="dismissed")
        r = await client.get(
            f"/v1/email/job-emails?job_listing_id={job.job_listing_id}"
        )
        assert r.status_code == 200
        assert [e["id"] for e in r.json()] == [str(mine.id)]
        assert r.json()[0]["company"] == "Vellacor"

    async def test_unsaved_listing_has_no_emails(
        self,
        client,
        db_session,
        test_user,
        enc_key,
    ):
        r = await client.get(f"/v1/email/job-emails?job_listing_id={uuid.uuid4()}")
        assert r.status_code == 200 and r.json() == []


@pytest.mark.asyncio
async def test_leftover_company_name_from_an_older_scan_is_not_shown(
    client, db_session, test_user, enc_key
):
    """A row stored before the name fix keeps ".io"; the page gets no name, so
    it falls back to a plain sentence instead."""
    await _connect(client)
    await _event(
        db_session,
        test_user,
        await _account(db_session, test_user),
        status="unsaved",
        job_company=".io",
        job_title="Data Engineer",
    )
    (ev,) = (await client.get("/v1/email/events")).json()
    assert ev["company"] is None and ev["title"] == "Data Engineer"
