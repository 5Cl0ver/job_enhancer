"""API tests for connecting an inbox (email auto-status)."""

import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.models.email_account import EmailAccount
from app.models.email_folder_state import EmailFolderState
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services import email_imap, email_sync
from app.services.email_scan import EmailMessage
from app.services.email_sync import FolderCursor, FolderReport, SyncResult
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
def _as_sync(fake_fetch, interrupted=None):
    """Wrap a fake list-of-messages fetch as a sync result (inbox only)."""

    async def fake_sync(*args, **kwargs):
        msgs = await fake_fetch()
        for m in msgs:
            m.uidvalidity = m.uidvalidity or 1
        top = max((int(m.uid) for m in msgs), default=0)
        report = FolderReport("inbox", status="complete", headers_read=len(msgs))
        return SyncResult(
            messages=msgs,
            cursors={"INBOX": FolderCursor("INBOX", "inbox", 1, top, 1, 1)},
            reports=[report],
            interrupted=interrupted,
        )

    return fake_sync


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

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))

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

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
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

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        r = await client.post("/v1/email/scan")
        assert r.status_code == 400
        # Connection is flagged so the UI can prompt a reconnect.
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        assert acct.status == "error"

    async def test_scan_saves_cursor_and_reports_folders(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(uid="42", from_addr="a@b.example", subject="Hi", body="")
            ]

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        r = await client.post("/v1/email/scan")
        assert r.status_code == 200
        body = r.json()
        assert body["folders"][0]["role"] == "inbox"
        assert body["window_days"] == 45 and body["interrupted"] is None
        state = await db_session.scalar(select(EmailFolderState))
        assert state.folder_name == "INBOX" and state.last_uid == 42
        assert state.last_status == "complete"

    async def test_rate_limited_scan_keeps_results_and_backs_off(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)
        await _create_saved_job(db_session, test_user, "Globex", "Frontend Developer")

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="7",
                    from_addr="talent@globex.example",
                    subject="Interview with Globex — Frontend Developer",
                    body="We'd like to schedule a call. What's your availability?",
                )
            ]

        monkeypatch.setattr(
            email_sync, "sync_mailbox", _as_sync(fake_fetch, interrupted="rate_limited")
        )
        first = await client.post("/v1/email/scan")
        assert first.status_code == 200
        assert first.json()["detected"] == 1  # work done before the limit is kept
        assert first.json()["interrupted"] == "rate_limited"
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        await db_session.refresh(acct)
        assert acct.sync_backoff_level == 1 and acct.sync_backoff_until is not None

        # During the backoff a scan doesn't connect at all.
        async def must_not_connect(*args, **kwargs):
            raise AssertionError("scan connected during backoff")

        monkeypatch.setattr(email_sync, "sync_mailbox", must_not_connect)
        second = await client.post("/v1/email/scan")
        assert second.status_code == 429 and "Retry-After" in second.headers

    async def test_connection_failure_backs_off(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)

        async def fail(*args, **kwargs):
            raise email_sync.SyncInterrupted(email_sync.CONNECTION_LOST, "connect")

        monkeypatch.setattr(email_sync, "sync_mailbox", fail)
        r = await client.post("/v1/email/scan")
        assert r.status_code == 502
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        await db_session.refresh(acct)
        assert acct.sync_backoff_level == 1

    async def test_scan_response_reports_evidence_and_review_candidates(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await self._connect(client)
        await _create_saved_job(
            db_session, test_user, "Quillfeather Labs", "Backend Engineer"
        )
        await _create_saved_job(
            db_session, test_user, "Quillfeather Labs", "Frontend Engineer"
        )

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="31",
                    from_addr="Priya Okafor <priya@quillfeather.example>",
                    subject="Interview for Frontend Engineer",
                    body="We'd like to schedule an interview for the Frontend Engineer role.",
                ),
                EmailMessage(
                    uid="32",
                    from_addr="Quillfeather Careers <careers@quillfeather.example>",
                    subject="Quillfeather Labs — next steps",
                    body="We'd like to schedule an interview. What's your availability?",
                ),
            ]

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        body = (await client.post("/v1/email/scan")).json()
        (ev,) = body["events"]
        assert ev["match_evidence"] == "company_title"
        (item,) = body["review"]
        assert item["status"] == "needs_review" and item["saved_job_id"] is None
        assert item["review_reason"] == "several_roles"
        assert {x["title"] for x in item["candidates"]} == {
            "Backend Engineer",
            "Frontend Engineer",
        }
        # Both survive the scan: listed with their evidence afterwards.
        listed = {e["id"]: e for e in (await client.get("/v1/email/events")).json()}
        assert listed[ev["id"]]["match_evidence"] == "company_title"
        assert listed[item["id"]]["review_reason"] == "several_roles"
        assert len(listed[item["id"]]["candidates"]) == 2


@pytest.mark.asyncio
class TestReviewItems:
    """Needs-review items: pick the job (one click), or dismiss."""

    async def _scan_unclear(self, client, db_session, test_user, monkeypatch, body):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "app-pass"},
        )
        backend = await _create_saved_job(
            db_session, test_user, "Quillfeather Labs", "Backend Engineer"
        )
        frontend = await _create_saved_job(
            db_session, test_user, "Quillfeather Labs", "Frontend Engineer"
        )
        other = await _create_saved_job(db_session, test_user, "Brambleworks", "Dev")

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="41",
                    from_addr="Quillfeather Careers <careers@quillfeather.example>",
                    subject="Quillfeather Labs — next steps",
                    body=body,
                )
            ]

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        (item,) = (await client.post("/v1/email/scan")).json()["review"]
        return item, backend, frontend, other

    async def test_pick_a_candidate_then_approve(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        item, _, frontend, _ = await self._scan_unclear(
            client,
            db_session,
            test_user,
            monkeypatch,
            "We'd like to schedule an interview. What's your availability?",
        )
        pick = next(c for c in item["candidates"] if c["title"] == "Frontend Engineer")
        # Approving before choosing is refused.
        early = await client.post(f"/v1/email/events/{item['id']}/apply")
        assert early.status_code == 409

        r = await client.post(
            f"/v1/email/events/{item['id']}/resolve",
            json={"saved_job_id": pick["saved_job_id"]},
        )
        assert r.status_code == 200
        ev = r.json()
        assert ev["status"] == "pending" and ev["saved_job_id"] == str(frontend.id)
        assert ev["target_stage"] == "Interview"
        assert ev["match_evidence"] == "several_roles"  # the original reason kept

        assert (
            await client.post(f"/v1/email/events/{ev['id']}/apply")
        ).status_code == 200
        interview = await db_session.scalar(
            select(PipelineStage).where(
                PipelineStage.user_id == test_user.id,
                PipelineStage.name == "Interview",
            )
        )
        await db_session.refresh(frontend)
        assert frontend.pipeline_stage_id == interview.id

    async def test_can_pick_a_job_outside_the_candidates(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        item, _, _, other = await self._scan_unclear(
            client,
            db_session,
            test_user,
            monkeypatch,
            "We'd like to schedule an interview. What's your availability?",
        )
        r = await client.post(
            f"/v1/email/events/{item['id']}/resolve",
            json={"saved_job_id": str(other.id)},
        )
        assert r.status_code == 200 and r.json()["saved_job_id"] == str(other.id)

    async def test_resolve_rejects_someone_elses_job(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        item, *_ = await self._scan_unclear(
            client,
            db_session,
            test_user,
            monkeypatch,
            "We'd like to schedule an interview. What's your availability?",
        )
        r = await client.post(
            f"/v1/email/events/{item['id']}/resolve",
            json={"saved_job_id": str(uuid.uuid4())},
        )
        assert r.status_code == 404

    async def test_dismiss_removes_it_from_the_list(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        item, *_ = await self._scan_unclear(
            client,
            db_session,
            test_user,
            monkeypatch,
            "We'd like to schedule an interview. What's your availability?",
        )
        r = await client.post(f"/v1/email/events/{item['id']}/dismiss")
        assert r.status_code == 200 and r.json()["status"] == "dismissed"
        assert (await client.get("/v1/email/events")).json() == []

    async def test_unsure_email_is_hidden_not_a_question(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "app-pass"},
        )
        await _create_saved_job(
            db_session, test_user, "Quillfeather Labs", "Backend Engineer"
        )

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="42",
                    from_addr="Quillfeather Careers <careers@quillfeather.example>",
                    subject="Quillfeather Labs — next steps",
                    body="We regret to inform you the Backend Engineer role is closed. "
                    "We'd like to schedule an interview for another role instead.",
                )
            ]

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        body = (await client.post("/v1/email/scan")).json()
        assert body["review"] == [] and body["hidden"] == 1
        (item,) = (await client.get("/v1/email/events")).json()
        assert item["category"] == "hidden" and item["event_type"] == "unsure"
        assert (
            await client.post(f"/v1/email/events/{item['id']}/apply")
        ).status_code == 409
        gone = await client.post(f"/v1/email/events/{item['id']}/dismiss")
        assert gone.status_code == 200 and gone.json()["status"] == "dismissed"

    async def test_resolving_twice_is_refused(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        item, backend, _, _ = await self._scan_unclear(
            client,
            db_session,
            test_user,
            monkeypatch,
            "We'd like to schedule an interview. What's your availability?",
        )
        url = f"/v1/email/events/{item['id']}/resolve"
        assert (
            await client.post(url, json={"saved_job_id": str(backend.id)})
        ).status_code == 200
        again = await client.post(url, json={"saved_job_id": str(backend.id)})
        assert again.status_code == 409


@pytest.mark.asyncio
class TestUnsavedJobs:
    """'Not in your saved jobs': kept, never moves a card; add it or dismiss it."""

    async def _scan(self, client, db_session, test_user, monkeypatch):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "app-pass"},
        )
        await _create_saved_job(db_session, test_user, "Brambleworks", "Dev")

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="61",
                    from_addr="Vellacor Careers <careers@vellacor.example>",
                    subject="Your application to Vellacor",
                    body="Thank you for your application for the Data Engineer "
                    "position. Unfortunately we will not be moving forward.",
                ),
                EmailMessage(
                    uid="62",
                    from_addr="Maren Holt <maren@tidelock.example>",
                    subject="Opportunity at Tidelock",
                    body="Hi! I'm a recruiter at Tidelock and came across your "
                    "background. Would you be open to a quick chat?",
                ),
            ]

        monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        body = (await client.post("/v1/email/scan")).json()
        assert (body["detected"], body["unsaved"], body["contacts"]) == (0, 1, 1)
        events = {
            e["category"]: e for e in (await client.get("/v1/email/events")).json()
        }
        return events["unsaved"], events["contact"]

    async def test_listed_with_names_and_never_applied(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        unsaved, contact = await self._scan(client, db_session, test_user, monkeypatch)
        assert (unsaved["company"], unsaved["title"]) == ("Vellacor", "Data Engineer")
        assert unsaved["event_type"] == "rejected" and unsaved["saved_job_id"] is None
        assert contact["company"] == "Tidelock" and contact["target_stage"] is None
        for item in (unsaved, contact):
            r = await client.post(f"/v1/email/events/{item['id']}/apply")
            assert r.status_code == 409  # nothing moves on its own

    async def test_add_to_my_jobs_creates_the_card_in_that_stage(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        unsaved, _ = await self._scan(client, db_session, test_user, monkeypatch)
        r = await client.post(
            f"/v1/email/events/{unsaved['id']}/track",
            json={"company": "Vellacor", "title": "Data Engineer"},
        )
        assert r.status_code == 200
        ev = r.json()
        assert ev["status"] == "applied" and ev["saved_job_id"]
        sj = await db_session.get(SavedJob, uuid.UUID(ev["saved_job_id"]))
        stage = await db_session.get(PipelineStage, sj.pipeline_stage_id)
        listing = await db_session.get(JobListing, sj.job_listing_id)
        assert stage.name == "Rejected"
        assert (listing.company, listing.title) == ("Vellacor", "Data Engineer")
        # It's done: not listed any more, and can't be added twice.
        ids = {e["id"] for e in (await client.get("/v1/email/events")).json()}
        assert unsaved["id"] not in ids
        again = await client.post(
            f"/v1/email/events/{unsaved['id']}/track",
            json={"company": "Vellacor", "title": "Data Engineer"},
        )
        assert again.status_code == 409

    async def test_dismiss_and_validation(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        unsaved, contact = await self._scan(client, db_session, test_user, monkeypatch)
        bad = await client.post(
            f"/v1/email/events/{unsaved['id']}/track",
            json={"company": "", "title": "x"},
        )
        assert bad.status_code == 422
        not_unsaved = await client.post(
            f"/v1/email/events/{contact['id']}/track",
            json={"company": "Tidelock", "title": "Recruiter"},
        )
        assert not_unsaved.status_code == 409
        for item in (unsaved, contact):
            r = await client.post(f"/v1/email/events/{item['id']}/dismiss")
            assert r.json()["status"] == "dismissed"
        assert (await client.get("/v1/email/events")).json() == []


@pytest.mark.asyncio
class TestAutoMoveFlow:
    """A hiring-site template naming the saved job moves the card by itself."""

    async def _scan_template_rejection(self, client, db_session, test_user, mp):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "pw"},
        )
        assert r.status_code == 201
        job = await _create_saved_job(
            db_session, test_user, "Vellacor", "Data Engineer"
        )

        async def fake_fetch(*args, **kwargs):
            return [
                EmailMessage(
                    uid="20",
                    from_addr="Vellacor <vellacor@myworkday.com>",
                    subject="Thank you for your interest in Data Engineer at Vellacor",
                    body="Thank you for applying to the Data Engineer position. "
                    "Unfortunately we have decided to move forward with other "
                    "candidates.",
                )
            ]

        mp.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
        scan = await client.post("/v1/email/scan")
        assert scan.status_code == 200
        return job, scan.json()

    async def _stage_id(self, db, user, name):
        return await db.scalar(
            select(PipelineStage.id).where(
                PipelineStage.user_id == user.id, PipelineStage.name == name
            )
        )

    async def test_sure_update_moves_and_can_be_undone(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        job, scan = await self._scan_template_rejection(
            client, db_session, test_user, monkeypatch
        )
        assert scan["moved"] == 1
        await db_session.refresh(job)
        assert job.pipeline_stage_id == await self._stage_id(
            db_session, test_user, "Rejected"
        )

        events = (await client.get("/v1/email/events")).json()
        assert [(e["status"], e["category"]) for e in events] == [
            ("auto_applied", "moved")
        ]
        undone = await client.post(f"/v1/email/events/{events[0]['id']}/undo")
        assert undone.status_code == 200
        await db_session.refresh(job)
        assert job.pipeline_stage_id is None

    async def test_switched_off_waits_for_a_click(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "pw"},
        )
        assert r.status_code == 201
        off = await client.patch("/v1/email/account", json={"auto_move": False})
        assert off.status_code == 200 and off.json()["auto_move"] is False

        job, scan = await self._scan_template_rejection(
            client, db_session, test_user, monkeypatch
        )
        assert scan["moved"] == 0
        await db_session.refresh(job)
        assert job.pipeline_stage_id is None
        events = (await client.get("/v1/email/events")).json()
        assert [e["category"] for e in events] == ["important"]

    async def test_settings_need_a_connected_inbox(self, client):
        r = await client.patch("/v1/email/account", json={"auto_move": False})
        assert r.status_code == 404
