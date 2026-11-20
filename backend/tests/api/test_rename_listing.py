"""Fixing a saved job's name: kept on the user's own saved job, shown wherever
they see the job, and never written to the shared listing (so nobody else's
job, search results or duplicate checks change). Invented companies.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from tests.api.test_saved_jobs import sample_job  # noqa: F401 — fixture
from tests.api.test_scout_tracks import _other_user

MANUAL = {
    "url": "https://mail.yahoo.com/d/folders/1/messages/abc",
    "title": "next phase of our recruitment process in the Platform Engineer",
    "company": "Wren Calloway",
}


async def _manual(client, **over):
    r = await client.post("/v1/saved-jobs/manual", json={**MANUAL, **over})
    assert r.status_code == 201, r.text
    return r.json()


def _rename(client, job, **body):
    return client.patch(f"/v1/saved-jobs/{job['id']}/listing", json=body)


@pytest.mark.asyncio
class TestRename:
    async def test_the_users_name_shows_everywhere_they_see_the_job(
        self, client: AsyncClient
    ):
        job = await _manual(client)
        r = await _rename(
            client,
            job,
            title="  Platform   Engineer ",
            company="Vellacor",
            location="Springfield, IL",
            apply_url="https://careers.vellacor.example/9",
        )
        assert r.status_code == 200, r.text
        listing = r.json()["job_listing"]
        assert (
            listing["title"],
            listing["company"],
            listing["location"],
            listing["apply_url"],
        ) == (
            "Platform Engineer",
            "Vellacor",
            "Springfield, IL",
            "https://careers.vellacor.example/9",
        )
        assert r.json()["renamed"] is True
        # Same job, same page.
        assert r.json()["job_listing_id"] == job["job_listing_id"]
        # The list, and the job's own page, say the same.
        (listed,) = (await client.get("/v1/saved-jobs/")).json()
        assert listed["job_listing"]["title"] == "Platform Engineer"
        page = (await client.get(f"/v1/jobs/{job['job_listing_id']}")).json()
        assert (page["title"], page["company"]) == ("Platform Engineer", "Vellacor")

    async def test_saving_without_changes_is_fine(self, client: AsyncClient):
        job = await _manual(client)
        name = {"title": MANUAL["title"], "company": MANUAL["company"]}
        for _ in range(2):
            r = await _rename(client, job, **name, location="Not specified")
            assert r.status_code == 200, r.text
            assert r.json()["job_listing"]["title"] == MANUAL["title"]

    async def test_only_what_is_sent_changes(self, client: AsyncClient):
        job = await _manual(client, location="Remote")
        r = await _rename(client, job, apply_url="https://careers.vellacor.example/9")
        listing = r.json()["job_listing"]
        assert listing["title"] == MANUAL["title"] and listing["location"] == "Remote"
        assert listing["apply_url"] == "https://careers.vellacor.example/9"

    async def test_the_shared_listing_is_never_changed(
        self,
        client: AsyncClient,
        db_session,
        sample_job,  # noqa: F811
    ):
        """A job-board listing (and anyone else who saved it, or finds it in
        search) keeps its own name; the extension still knows it's saved."""
        feed_id = sample_job.id
        saved = (
            await client.post("/v1/saved-jobs/", json={"job_listing_id": str(feed_id)})
        ).json()
        other = await _other_user(db_session)
        theirs_id = uuid.uuid4()
        db_session.add(SavedJob(id=theirs_id, user_id=other.id, job_listing_id=feed_id))
        await db_session.commit()

        r = await _rename(client, saved, title="Backend Engineer", company="Acme")
        assert r.status_code == 200
        # Read fresh from the database (not the session's copies).
        listing = await db_session.get(JobListing, feed_id, populate_existing=True)
        assert (listing.title, listing.company) == ("Python Developer", "Acme Corp")
        theirs = await db_session.get(SavedJob, theirs_id, populate_existing=True)
        assert theirs.custom_title is None
        # No new listing was made for anyone to find.
        assert len((await db_session.scalars(select(JobListing))).all()) == 1
        # The extension's "already saved?" check reads the posting's own name.
        check = await client.post(
            "/v1/saved-jobs/check",
            json={
                "title": "Python Developer",
                "company": "Acme Corp",
                "location": "New York, NY",
            },
        )
        assert check.json()["saved"] is True

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"title": ""},
            {"company": "   "},
            {"apply_url": "javascript:alert(1)"},
            {"title": "x" * 501},
        ],
    )
    async def test_bad_input(self, client: AsyncClient, body):
        job = await _manual(client)
        assert (await _rename(client, job, **body)).status_code == 422

    async def test_someone_elses_job_is_not_found(
        self,
        client: AsyncClient,
        db_session,
        sample_job,  # noqa: F811
    ):
        feed_id = sample_job.id
        other = await _other_user(db_session)
        theirs_id = uuid.uuid4()
        db_session.add(SavedJob(id=theirs_id, user_id=other.id, job_listing_id=feed_id))
        await db_session.commit()
        r = await client.patch(
            f"/v1/saved-jobs/{theirs_id}/listing", json={"title": "Mine now"}
        )
        assert r.status_code == 404
        theirs = await db_session.get(SavedJob, theirs_id, populate_existing=True)
        assert theirs.custom_title is None
        # And another user's name for a job never shows on this user's page.
        page = (await client.get(f"/v1/jobs/{feed_id}")).json()
        assert page["title"] == "Python Developer"

    async def test_emails_are_matched_under_the_users_name(
        self, client: AsyncClient, db_session, test_user
    ):
        """After fixing the company, an email from that company finds the job."""
        from app.services.email_scan import _candidate_jobs

        job = await _manual(client)
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        (candidate,) = await _candidate_jobs(db_session, test_user.id)
        assert (candidate["company"], candidate["title"]) == (
            "Vellacor",
            "Platform Engineer",
        )


async def _email_event(db, user, saved_job_id, sender):
    account = await db.scalar(
        select(EmailAccount).where(EmailAccount.user_id == user.id)
    )
    if account is None:
        account = EmailAccount(
            id=uuid.uuid4(),
            user_id=user.id,
            email_address="me@mail.example",
            provider="yahoo",
            auth_type="app_password",
            imap_host="imap.mail.example",
            imap_port=993,
            secret_encrypted="x",
            status="connected",
        )
        db.add(account)
        await db.flush()
    db.add(
        DetectedEvent(
            id=uuid.uuid4(),
            user_id=user.id,
            email_account_id=account.id,
            saved_job_id=saved_job_id,
            event_type="interview",
            target_stage="Interview",
            from_addr=sender,
            subject="Interview",
            message_uid=uuid.uuid4().hex,
            logical_key=uuid.uuid4().hex,
            status="applied",
        )
    )
    await db.commit()


async def _flags(client):
    jobs = (await client.get("/v1/saved-jobs/")).json()
    return {j["id"]: j["name_doubtful"] for j in jobs}


async def _as_email_made(db_session):
    for sj in (await db_session.scalars(select(SavedJob))).all():
        sj.origin = "email"
    await db_session.commit()


@pytest.mark.asyncio
class TestDoubtfulNames:
    async def test_a_sentence_for_a_title_is_flagged_until_fixed(
        self, client: AsyncClient, db_session
    ):
        job = await _manual(client)
        fine = await _manual(client, title="Data Analyst", company="Quillstone")
        await _as_email_made(db_session)
        assert await _flags(client) == {job["id"]: True, fine["id"]: False}
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        assert (await _flags(client))[job["id"]] is False

    async def test_confirming_the_name_as_it_is_clears_the_flag(
        self, client: AsyncClient, db_session
    ):
        job = await _manual(client)
        await _as_email_made(db_session)
        await _rename(client, job, title=MANUAL["title"], company=MANUAL["company"])
        assert (await _flags(client))[job["id"]] is False

    async def test_the_sender_as_the_company_is_flagged(
        self, client: AsyncClient, db_session, test_user
    ):
        person = await _manual(client, title="Platform Engineer")
        team = await _manual(client, title="Data Analyst", company="Wells Fargo")
        await _as_email_made(db_session)
        await _email_event(
            db_session,
            test_user,
            uuid.UUID(person["id"]),
            "Wren Calloway <wren.calloway@vellacor.example>",
        )
        # A hiring system sending as the employer is not a person.
        for sender in (
            "Wells Fargo <wellsfargo@myworkday.com>",
            "Wells Fargo Careers <careers@wellsfargo.example>",
        ):
            await _email_event(db_session, test_user, uuid.UUID(team["id"]), sender)
        assert await _flags(client) == {person["id"]: True, team["id"]: False}

    async def test_a_typed_in_job_is_never_flagged(self, client: AsyncClient):
        job = await _manual(client)
        assert await _flags(client) == {job["id"]: False}


@pytest.mark.asyncio
class TestOwnNameIsUsed:
    """Everything that recognises a job for the user knows it by their name."""

    async def test_applying_on_the_employers_page_finds_the_renamed_job(
        self, client: AsyncClient
    ):
        job = await _manual(client)
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        r = await client.post(
            "/v1/saved-jobs/mark-applied",
            json={"title": "Platform Engineer", "company": "Vellacor"},
        )
        assert r.status_code == 200 and r.json()["matched"] is True
        (listed,) = (await client.get("/v1/saved-jobs/")).json()
        assert listed["applied_at"] is not None

    async def test_a_board_sync_doesnt_import_a_renamed_job_twice(
        self, client: AsyncClient
    ):
        job = await _manual(client)
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        r = await client.post(
            "/v1/saved-jobs/sync-applications",
            json={
                "applications": [
                    {
                        "title": "Platform Engineer",
                        "company": "Vellacor",
                        "stage": "Applied",
                    }
                ]
            },
        )
        assert r.json()["imported"] == 0 and r.json()["updated"] == 1
        assert len((await client.get("/v1/saved-jobs/")).json()) == 1

    async def test_scout_knows_a_renamed_job_is_already_tracked(
        self, client: AsyncClient, db_session, test_user
    ):
        from app.services.scout_dedupe import company_key, title_key
        from app.services.scout_runs import _seen_jobs

        job = await _manual(client)
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        pair = (company_key("Vellacor"), title_key("Platform Engineer"))
        seen = await _seen_jobs(db_session, test_user.id, {pair}, set())
        assert seen == {pair: "in_tracker"}

    async def test_ai_documents_use_the_users_name(self, client: AsyncClient):
        from unittest.mock import AsyncMock, patch

        job = await _manual(client)
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        with patch(
            "app.api.v1.ai.resume_parser.parse_resume",
            new=AsyncMock(return_value="Jane Dev — Python, Kubernetes"),
        ):
            resume = (
                await client.post(
                    "/v1/ai/resumes",
                    files={"file": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
                )
            ).json()
        r = await client.post(
            "/v1/ai/prompt",
            json={
                "resume_id": resume["id"],
                "document_type": "cover_letter",
                "job_listing_id": job["job_listing_id"],
            },
        )
        assert r.status_code == 200, r.text
        prompt = r.json()["prompt"]
        assert "Platform Engineer" in prompt and "Vellacor" in prompt
        assert "Wren Calloway" not in prompt
