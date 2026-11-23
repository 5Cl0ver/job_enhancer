"""Spec 015 (PR #29 review): matching a saved job by its posting link, and
never sharing what isn't the user's. Invented people and jobs only."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.schemas.saved_job import ManualJobCreate
from app.services.saved_jobs import save_manual_job
from tests.api.test_scout_tracks import _other_user

SEARCH = "https://www.ziprecruiter.com/jobs-search?search=technician"
POSTING = "Install and repair lab equipment at customer sites. " * 20


async def _save(client, **job):
    r = await client.post("/v1/saved-jobs/manual", json=job)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
class TestLinkMatch:
    async def test_a_link_alone_is_not_the_same_job(self, client: AsyncClient):
        # Two jobs saved from one search page share its link.
        await _save(
            client, url=SEARCH, title="Field Technician", company="Tidewell Labs"
        )
        other = {
            "url": SEARCH,
            "title": "Warehouse Associate",
            "company": "Quillstone",
            "location": "Harborview, OR",
        }
        check = await client.post("/v1/saved-jobs/check", json=other)
        assert check.json()["saved"] is False
        filled = await client.post(
            "/v1/saved-jobs/backfill", json={**other, "description": POSTING}
        )
        assert filled.json()["updated"] is False
        (job,) = (await client.get("/v1/saved-jobs/")).json()
        assert job["job_listing"]["title"] == "Field Technician"

    async def test_the_same_job_by_link_is_found_and_filled(self, client: AsyncClient):
        await _save(
            client,
            url="https://careers.tidewell.example/jobs/42",
            title="Field Service Technician",
            company="Tidewell Labs",
        )
        page = {
            "url": "https://careers.tidewell.example/jobs/42/",
            "title": "Field Service Technician",
            "company": "Tidewell Labs",
            "location": "Harborview, OR",
            "is_remote": True,
        }
        filled = await client.post(
            "/v1/saved-jobs/backfill", json={**page, "description": POSTING}
        )
        fields = filled.json()["fields"]
        assert "description" in fields and "location" in fields
        # Found by link only: remote-ness isn't "corrected" from it.
        assert "is_remote" not in fields

    async def test_a_listing_another_user_saved_is_never_changed(
        self, client: AsyncClient, db_session
    ):
        other = await _other_user(db_session)
        job = ManualJobCreate(
            url="https://careers.tidewell.example/jobs/7",
            title="Lab Technician",
            company="Tidewell Labs",
        )
        await save_manual_job(db_session, other.id, job)
        await _save(client, **job.model_dump(include={"url", "title", "company"}))
        filled = await client.post(
            "/v1/saved-jobs/backfill",
            json={
                **job.model_dump(include={"url", "title", "company"}),
                "description": POSTING,
            },
        )
        assert filled.json()["updated"] is False
        listing = await db_session.scalar(
            select(JobListing).where(JobListing.title == "Lab Technician")
        )
        assert not listing.description


@pytest.mark.asyncio
class TestEmailJobsStayPrivate:
    async def test_another_users_email_made_job_is_not_shared(
        self, client: AsyncClient, db_session, test_user
    ):
        other = await _other_user(db_session)
        mailbox = "https://mail.yahoo.com/d/search/keyword=Interview%20with%20Rowan"
        await save_manual_job(
            db_session,
            other.id,
            ManualJobCreate(url=mailbox, title="Support Engineer", company="Vellacor"),
        )
        mine = await _save(
            client,
            url="https://careers.vellacor.example/jobs/9",
            title="Support Engineer",
            company="Vellacor",
        )
        assert (
            mine["job_listing"]["apply_url"]
            == "https://careers.vellacor.example/jobs/9"
        )
        listings = list(
            await db_session.scalars(
                select(JobListing).where(JobListing.title == "Support Engineer")
            )
        )
        assert len(listings) == 2
        theirs = await db_session.scalar(
            select(SavedJob).where(SavedJob.user_id == other.id)
        )
        assert theirs.job_listing_id != mine["job_listing_id"]
