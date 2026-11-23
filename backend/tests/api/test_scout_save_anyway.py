"""Spec 015: "Save anyway" — a Scout job whose page was never copied can still
go to My Jobs from the title, company and link Claude read. The job then counts
as needing details, so Job Catcher adds the posting the next time it's opened.
Invented companies and jobs only."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.scout import ScoutFinding
from app.services import scout_runs
from tests.api.test_scout_review import _other_user, _run, _url

FACTS = {"title": "Field Service Technician", "company": "Tidewell Labs"}


async def _no_copy(db, user, *, facts=FACTS, name="strong"):
    run = await _run(db, user)
    for _ in range(3):  # the third report without a copy gives up: no_copy
        await scout_runs.report_job(
            db, user.id, str(run.id), _url(name), 8, "fits", "gaps", facts=facts
        )
        await db.commit()
    finding = await db.scalar(select(ScoutFinding).where(ScoutFinding.run_id == run.id))
    return run, finding


@pytest.mark.asyncio
class TestSaveAnyway:
    async def test_results_offer_it_only_without_a_copy(
        self, client: AsyncClient, db_session, test_user
    ):
        _, finding = await _no_copy(db_session, test_user)
        assert finding.outcome == "no_copy"
        items = (await client.get("/v1/scout/findings?run=last")).json()["items"]
        (item,) = items
        assert item["can_save"] is False
        assert item["can_save_anyway"] is True

    async def test_saves_a_thin_job_that_needs_details(
        self, client: AsyncClient, db_session, test_user
    ):
        _, finding = await _no_copy(db_session, test_user)
        r = await client.post(
            f"/v1/scout/findings/{finding.id}/save", json={"anyway": True}
        )
        assert r.status_code == 200, r.text
        assert r.json()["already"] is False
        (job,) = (await client.get("/v1/saved-jobs/")).json()
        assert job["job_listing"]["title"] == "Field Service Technician"
        assert job["job_listing"]["company"] == "Tidewell Labs"
        assert job["job_listing"]["apply_url"] == _url("strong").rstrip("/")
        assert not job["job_listing"].get("description")
        assert job["origin"] == "scout"
        # Job Catcher is asked for the full posting next time the page is open
        # — found by its link, though the page words the location its own way.
        page = {
            "title": "Field Service Technician",
            "company": "Tidewell Labs",
            "location": "Harborview, OR (On-site)",
            "url": _url("strong"),
        }
        check = await client.post("/v1/saved-jobs/check", json=page)
        assert check.json() == {"saved": True, "needs_details": True}
        posting = "Install and repair lab equipment at customer sites. " * 20
        filled = await client.post(
            "/v1/saved-jobs/backfill", json={**page, "description": posting}
        )
        assert set(filled.json()["fields"]) >= {"description", "location"}
        (job,) = (await client.get("/v1/saved-jobs/")).json()
        assert job["job_listing"]["location"] == "Harborview, OR (On-site)"
        # Saving again answers "already", not a second job.
        again = await client.post(
            f"/v1/scout/findings/{finding.id}/save", json={"anyway": True}
        )
        assert again.json()["already"] is True
        assert len((await client.get("/v1/saved-jobs/")).json()) == 1

    async def test_without_anyway_it_still_needs_a_copy(
        self, client: AsyncClient, db_session, test_user
    ):
        _, finding = await _no_copy(db_session, test_user)
        r = await client.post(f"/v1/scout/findings/{finding.id}/save", json={})
        assert r.status_code == 409

    async def test_not_without_a_title_and_company(
        self, client: AsyncClient, db_session, test_user
    ):
        _, finding = await _no_copy(db_session, test_user, facts={})
        items = (await client.get("/v1/scout/findings?run=last")).json()["items"]
        assert items[0]["can_save_anyway"] is False
        r = await client.post(
            f"/v1/scout/findings/{finding.id}/save", json={"anyway": True}
        )
        assert r.status_code == 409

    async def test_someone_elses_finding_is_not_found(
        self, client: AsyncClient, db_session, test_user
    ):
        other = await _other_user(db_session)
        _, finding = await _no_copy(db_session, other)
        r = await client.post(
            f"/v1/scout/findings/{finding.id}/save", json={"anyway": True}
        )
        assert r.status_code == 404
