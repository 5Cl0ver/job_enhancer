"""Every saved job records how it got into My Jobs, and can say where it is.

The Scout, email and Claude paths are checked next to their own tests
(test_mcp_scout, test_email, test_mcp_server); this covers the app's own saves,
the list payload and the "where this came from" answer. Invented companies.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.saved_job import SavedJob
from tests.api.test_saved_jobs import sample_job  # noqa: F401 — fixture
from tests.api.test_scout_tracks import _other_user

MANUAL = {
    "url": "https://careers.vellacor.example/jobs/41",
    "title": "Systems Administrator",
    "company": "Vellacor",
    "location": "Springfield, IL",
}


@pytest.mark.asyncio
class TestOrigin:
    async def test_job_board_result_is_search(self, client: AsyncClient, sample_job):  # noqa: F811
        r = await client.post(
            "/v1/saved-jobs/", json={"job_listing_id": str(sample_job.id)}
        )
        assert r.status_code == 201
        assert r.json()["origin"] == "search"

    async def test_the_apps_form_is_manual_and_job_catcher_says_so(
        self, client: AsyncClient
    ):
        typed = await client.post("/v1/saved-jobs/manual", json=MANUAL)
        assert typed.status_code == 201 and typed.json()["origin"] == "manual"
        caught = await client.post(
            "/v1/saved-jobs/manual",
            json={**MANUAL, "title": "IT Administrator", "origin": "extension"},
        )
        assert caught.status_code == 201 and caught.json()["origin"] == "extension"

    @pytest.mark.parametrize("claimed", ["scout", "email", "claude", "search", ""])
    async def test_a_request_cannot_claim_a_server_origin(
        self, client: AsyncClient, claimed
    ):
        r = await client.post(
            "/v1/saved-jobs/manual", json={**MANUAL, "origin": claimed}
        )
        assert r.status_code == 422

    async def test_saving_it_again_keeps_the_first_origin(self, client: AsyncClient):
        first = (await client.post("/v1/saved-jobs/manual", json=MANUAL)).json()
        again = await client.post(
            "/v1/saved-jobs/manual", json={**MANUAL, "origin": "extension"}
        )
        assert again.json()["id"] == first["id"]
        assert again.json()["origin"] == "manual"

    async def test_the_list_carries_origin_and_no_scout_score_for_other_jobs(
        self, client: AsyncClient
    ):
        await client.post("/v1/saved-jobs/manual", json=MANUAL)
        (job,) = (await client.get("/v1/saved-jobs/")).json()
        assert job["origin"] == "manual" and job["scout"] is None


@pytest.mark.asyncio
class TestSource:
    async def test_says_the_folder_and_nothing_it_does_not_know(
        self, client: AsyncClient
    ):
        folder = (
            await client.post("/v1/collections/", json={"name": "IT Admin"})
        ).json()
        job = (
            await client.post(
                "/v1/saved-jobs/manual",
                json={**MANUAL, "collection_id": folder["id"]},
            )
        ).json()
        r = await client.get(f"/v1/saved-jobs/{job['id']}/source")
        assert r.status_code == 200
        src = r.json()
        assert src["origin"] == "manual" and src["saved_at"]
        assert src["collection"] == {"id": folder["id"], "name": "IT Admin"}
        assert src["scout"] is None and src["email"] is None

    async def test_someone_elses_job_is_not_found(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_job,  # noqa: F811
    ):
        other = await _other_user(db_session)
        theirs = SavedJob(
            id=uuid.uuid4(), user_id=other.id, job_listing_id=sample_job.id
        )
        db_session.add(theirs)
        await db_session.commit()
        r = await client.get(f"/v1/saved-jobs/{theirs.id}/source")
        assert r.status_code == 404
        assert (
            await client.get(f"/v1/saved-jobs/{uuid.uuid4()}/source")
        ).status_code == 404
