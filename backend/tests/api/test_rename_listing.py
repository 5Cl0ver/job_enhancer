"""Fixing a saved job's name: only this user's job changes, never a listing
someone else relies on, and never into a copy of a job they already have.
Invented companies throughout.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from tests.api.test_saved_jobs import sample_job  # noqa: F401 — fixture
from tests.api.test_scout_tracks import _other_user

MANUAL = {
    "url": "https://mail.yahoo.com/d/folders/1/messages/abc",
    "title": "next phase of our recruitment process in the Platform Engineer",
    "company": "Nancy Karnas",
}


async def _manual(client, **over):
    r = await client.post("/v1/saved-jobs/manual", json={**MANUAL, **over})
    assert r.status_code == 201, r.text
    return r.json()


def _rename(client, job, **body):
    return client.patch(f"/v1/saved-jobs/{job['id']}/listing", json=body)


@pytest.mark.asyncio
class TestRename:
    async def test_fixes_the_name_in_place_for_a_job_only_this_user_has(
        self, client: AsyncClient
    ):
        job = await _manual(client)
        r = await _rename(
            client,
            job,
            title="  Platform   Engineer ",
            company="Vellacor",
            location="Springfield, IL",
        )
        assert r.status_code == 200, r.text
        listing = r.json()["job_listing"]
        assert (listing["title"], listing["company"], listing["location"]) == (
            "Platform Engineer",
            "Vellacor",
            "Springfield, IL",
        )
        # Same listing: nobody else had it.
        assert r.json()["job_listing_id"] == job["job_listing_id"]
        # And it's found under its new name.
        check = await client.post(
            "/v1/saved-jobs/check",
            json={
                "title": "Platform Engineer",
                "company": "Vellacor",
                "location": "Springfield, IL",
            },
        )
        assert check.json()["saved"] is True

    async def test_only_what_is_sent_changes(self, client: AsyncClient):
        job = await _manual(client, location="Remote")
        r = await _rename(client, job, apply_url="https://careers.vellacor.example/9")
        listing = r.json()["job_listing"]
        assert listing["title"] == MANUAL["title"] and listing["location"] == "Remote"
        assert listing["apply_url"] == "https://careers.vellacor.example/9"

    async def test_a_listing_someone_else_saved_is_copied_not_changed(
        self, client: AsyncClient, db_session, test_user
    ):
        job = await _manual(client, title="Data Engineer", company="Quillstone")
        other = await _other_user(db_session)
        theirs = SavedJob(
            id=uuid.uuid4(),
            user_id=other.id,
            job_listing_id=uuid.UUID(job["job_listing_id"]),
        )
        doc = GeneratedDocument(
            id=uuid.uuid4(),
            user_id=test_user.id,
            job_listing_id=uuid.UUID(job["job_listing_id"]),
            document_type="cover_letter",
            content="Dear Quillstone team",
        )
        db_session.add_all([theirs, doc])
        await db_session.commit()
        doc_id = doc.id

        r = await _rename(client, job, title="Senior Data Engineer")
        assert r.status_code == 200, r.text
        moved_to = r.json()["job_listing_id"]
        assert moved_to != job["job_listing_id"]
        # Theirs is untouched.
        db_session.expire_all()
        original = await db_session.get(JobListing, uuid.UUID(job["job_listing_id"]))
        assert original.title == "Data Engineer"
        copy = await db_session.get(JobListing, uuid.UUID(moved_to))
        assert (copy.title, copy.company, copy.source) == (
            "Senior Data Engineer",
            "Quillstone",
            "manual",
        )
        # The user's letter follows the job to its copy.
        assert (
            await db_session.get(GeneratedDocument, doc_id)
        ).job_listing_id == copy.id

    async def test_a_job_board_listing_is_copied(
        self,
        client: AsyncClient,
        db_session,
        sample_job,  # noqa: F811
    ):
        feed_id = sample_job.id
        saved = (
            await client.post("/v1/saved-jobs/", json={"job_listing_id": str(feed_id)})
        ).json()
        r = await _rename(client, saved, company="Acme Corporation")
        assert r.status_code == 200
        assert r.json()["job_listing_id"] != str(feed_id)
        db_session.expire_all()
        assert (await db_session.get(JobListing, feed_id)).company == "Acme Corp"

    async def test_renaming_into_a_job_already_saved_is_refused(
        self, client: AsyncClient
    ):
        await _manual(client, title="Platform Engineer", company="Vellacor")
        job = await _manual(client)
        r = await _rename(client, job, title="Platform Engineer", company="Vellacor")
        assert r.status_code == 409
        assert r.json()["detail"] == "You already have this job saved."
        (await client.get("/v1/saved-jobs/")).json()

    async def test_a_name_another_user_has_keeps_the_jobs_apart(
        self, client: AsyncClient, db_session
    ):
        """Someone else saved a job by the new name: this job is renamed, and
        neither listing becomes the other."""
        job = await _manual(client)
        other = await _other_user(db_session)
        await db_session.commit()
        from app.schemas.saved_job import ManualJobCreate
        from app.services.saved_jobs import save_manual_job

        theirs = await save_manual_job(
            db_session,
            other.id,
            ManualJobCreate(
                url="https://careers.vellacor.example/1",
                title="Platform Engineer",
                company="Vellacor",
            ),
        )
        await db_session.commit()
        r = await _rename(client, job, title="Platform Engineer", company="Vellacor")
        assert r.status_code == 200, r.text
        assert r.json()["job_listing_id"] not in (str(theirs.job_listing_id),)
        assert r.json()["job_listing"]["title"] == "Platform Engineer"

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
        db_session.expire_all()
        listing = await db_session.scalar(
            select(JobListing).where(JobListing.id == feed_id)
        )
        assert listing.title == "Python Developer"


@pytest.mark.asyncio
class TestDoubtfulNames:
    async def test_an_email_made_job_with_a_sentence_for_a_title_is_flagged(
        self, client: AsyncClient, db_session
    ):
        job = await _manual(client)
        await _manual(client, title="Data Analyst", company="Quillstone")
        # Only jobs made from emails are checked.
        for sj in (await db_session.scalars(select(SavedJob))).all():
            sj.origin = "email"
        await db_session.commit()
        jobs = {j["id"]: j for j in (await client.get("/v1/saved-jobs/")).json()}
        assert jobs[job["id"]]["name_doubtful"] is True
        others = [j for j in jobs.values() if j["id"] != job["id"]]
        assert [j["name_doubtful"] for j in others] == [False]

        # Fixed: no longer flagged.
        await _rename(client, job, title="Platform Engineer", company="Vellacor")
        jobs = {j["id"]: j for j in (await client.get("/v1/saved-jobs/")).json()}
        assert jobs[job["id"]]["name_doubtful"] is False

    async def test_a_typed_in_job_is_never_flagged(self, client: AsyncClient):
        job = await _manual(client)
        (listed,) = (await client.get("/v1/saved-jobs/")).json()
        assert listed["id"] == job["id"] and listed["name_doubtful"] is False
