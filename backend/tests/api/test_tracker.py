"""Integration tests for the pipeline tracker: stages CRUD + moving jobs."""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_listing import JobListing
from app.services.dedup import job_content_hash, normalize

DEFAULT_STAGE_NAMES = [
    "Interested",
    "Referral Sent",
    "Applied",
    "Phone Screen",
    "Take-Home Assignment",
    "Interview",
    "Offer",
    "Rejected",
]


@pytest_asyncio.fixture
async def saved_job(client: AsyncClient, db_session: AsyncSession) -> dict:
    job = JobListing(
        id=uuid.uuid4(),
        external_id="jsearch_777",
        source="jsearch",
        title="Backend Engineer",
        company="TrackerCo",
        location="Austin, TX",
        is_remote=False,
        apply_url="https://example.com/tracker",
        content_hash=job_content_hash(
            normalize("Backend Engineer"),
            normalize("TrackerCo"),
            normalize("Austin, TX"),
        ),
        title_normalized=normalize("Backend Engineer"),
        company_normalized=normalize("TrackerCo"),
    )
    db_session.add(job)
    await db_session.commit()
    response = await client.post(
        "/v1/saved-jobs/", json={"job_listing_id": str(job.id)}
    )
    return response.json()


@pytest.mark.asyncio
async def test_default_stages_seeded(client: AsyncClient):
    """FR-007: the 8 default stages exist for a new user, in order."""
    response = await client.get("/v1/pipeline-stages/")
    assert response.status_code == 200
    stages = response.json()
    assert [s["name"] for s in stages] == DEFAULT_STAGE_NAMES
    assert all(s["is_default"] for s in stages)


@pytest.mark.asyncio
async def test_create_and_delete_custom_stage(client: AsyncClient):
    """FR-007a: users can add and remove their own stages."""
    response = await client.post(
        "/v1/pipeline-stages/", json={"name": "Coding Challenge"}
    )
    assert response.status_code == 201
    stage = response.json()
    assert stage["is_default"] is False

    response = await client.delete(f"/v1/pipeline-stages/{stage['id']}")
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_delete_default_stage_blocked(client: AsyncClient):
    stages = (await client.get("/v1/pipeline-stages/")).json()
    default = next(s for s in stages if s["is_default"])
    response = await client.delete(f"/v1/pipeline-stages/{default['id']}")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_move_job_to_applied_sets_date(client: AsyncClient, saved_job: dict):
    """FR-006a groundwork: moving into 'Applied' records the application date."""
    stages = (await client.get("/v1/pipeline-stages/")).json()
    applied = next(s for s in stages if s["name"] == "Applied")

    response = await client.post(
        "/v1/pipeline-stages/move",
        json={"saved_job_id": saved_job["id"], "stage_id": applied["id"]},
    )
    assert response.status_code == 200
    moved = response.json()
    assert moved["pipeline_stage_id"] == applied["id"]
    assert moved["applied_at"] is not None
