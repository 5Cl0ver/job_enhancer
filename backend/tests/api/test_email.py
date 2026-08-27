"""API tests for connecting an inbox (email auto-status)."""

import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services import email_imap
from app.services.email_scan import EmailMessage
from app.utils import crypto


@pytest_asyncio.fixture
def enc_key(monkeypatch):
    """Configure a real encryption key so /connect is enabled during tests."""
    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


async def _create_saved_job(db, user, company, title):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title=title,
        company=company,
        location="Remote",
        apply_url="https://example.com",
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
    )
    db.add(sj)
    await db.flush()
    return sj


@pytest.mark.asyncio
class TestProviderDetect:
    async def test_detects_yahoo(self, client):
        r = await client.get("/v1/email/provider", params={"address": "a@yahoo.com"})
        assert r.status_code == 200
        assert r.json()["provider"] == "yahoo"
        assert r.json()["connect_method"] == "app_password"

    async def test_requires_auth(self, anon_client):
        r = await anon_client.get(
            "/v1/email/provider", params={"address": "a@yahoo.com"}
        )
        assert r.status_code == 401


@pytest.mark.asyncio
class TestConnect:
    async def test_connect_stores_encrypted_secret(
        self, client, db_session, test_user, enc_key
    ):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "abcd-efgh"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["provider"] == "yahoo"
        assert body["imap_host"] == "imap.mail.yahoo.com"
        # The secret is never echoed back.
        assert "app_password" not in body
        assert "secret_encrypted" not in body

        # Stored form is ciphertext, and it decrypts back to the input.
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        assert acct.secret_encrypted != "abcd-efgh"
        assert crypto.decrypt(acct.secret_encrypted) == "abcd-efgh"

    async def test_reconnect_updates_in_place(self, client, db_session, enc_key):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "one"},
        )
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "two"},
        )
        assert r.status_code == 201
        accts = (await db_session.scalars(select(EmailAccount))).all()
        assert len(accts) == 1  # updated, not duplicated
        assert crypto.decrypt(accts[0].secret_encrypted) == "two"

    async def test_connect_disabled_without_key(self, client, monkeypatch):
        monkeypatch.setattr(settings, "mail_enc_key", "")
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "x"},
        )
        assert r.status_code == 503

    async def test_proton_without_host_rejected(self, client, enc_key):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@proton.me", "app_password": "x"},
        )
        assert r.status_code == 400


@pytest.mark.asyncio
class TestAccountLifecycle:
    async def test_account_null_when_not_connected(self, client):
        r = await client.get("/v1/email/account")
        assert r.status_code == 200
        assert r.json() is None

    async def test_get_then_disconnect(self, client, db_session, enc_key):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "pw"},
        )
        got = await client.get("/v1/email/account")
        assert got.status_code == 200
        assert got.json()["email_address"] == "me@yahoo.com"

        deleted = await client.delete("/v1/email/account")
        assert deleted.status_code == 204
        assert (await db_session.scalars(select(EmailAccount))).all() == []

    async def test_disconnect_when_none_is_404(self, client):
        r = await client.delete("/v1/email/account")
        assert r.status_code == 404


@pytest.mark.asyncio
class TestScanFlow:
    async def _connect(self, client):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "pw"},
        )
        assert r.status_code == 201

    async def test_scan_detects_and_full_review_cycle(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)
        job = await _create_saved_job(
            db_session, test_user, "Acme Corp", "Backend Engineer"
        )

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="10",
                    from_addr="no-reply@acme.com",
                    subject="Update on your application to Acme",
                    body="Unfortunately we have decided to move forward with "
                    "other candidates.",
                )
            ]

        monkeypatch.setattr(email_imap, "fetch_recent", fake_fetch)

        scan = await client.post("/v1/email/scan")
        assert scan.status_code == 200
        assert scan.json()["detected"] == 1

        events = (await client.get("/v1/email/events")).json()
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "rejected"
        assert ev["target_stage"] == "Rejected"

        # Approve → card moves to the Rejected stage.
        applied = await client.post(f"/v1/email/events/{ev['id']}/apply")
        assert applied.status_code == 200
        rejected_stage = await db_session.scalar(
            select(PipelineStage).where(
                PipelineStage.user_id == test_user.id,
                PipelineStage.name == "Rejected",
            )
        )
        await db_session.refresh(job)
        assert job.pipeline_stage_id == rejected_stage.id

        # Undo → card returns to where it was (no stage).
        undone = await client.post(f"/v1/email/events/{ev['id']}/undo")
        assert undone.status_code == 200
        await db_session.refresh(job)
        assert job.pipeline_stage_id is None

        # Nothing left pending.
        assert (await client.get("/v1/email/events")).json() == []

    async def test_rescan_is_idempotent(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)
        await _create_saved_job(db_session, test_user, "Globex", "Frontend Developer")

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="99",
                    from_addr="talent@globex.com",
                    subject="Interview with Globex — Frontend Developer",
                    body="We'd like to schedule a call. What's your availability?",
                )
            ]

        monkeypatch.setattr(email_imap, "fetch_recent", fake_fetch)
        first = await client.post("/v1/email/scan")
        assert first.json()["detected"] == 1
        second = await client.post("/v1/email/scan")
        assert second.json()["detected"] == 0  # same email, no new event

    async def test_scan_without_connection_is_404(self, client, enc_key):
        r = await client.post("/v1/email/scan")
        assert r.status_code == 404

    async def test_scan_bad_credentials_reports_error(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)

        async def fake_fetch(*args, **kwargs):
            raise email_imap.ImapAuthError("bad login")

        monkeypatch.setattr(email_imap, "fetch_recent", fake_fetch)
        r = await client.post("/v1/email/scan")
        assert r.status_code == 400
        # Connection is flagged so the UI can prompt a reconnect.
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        assert acct.status == "error"
