"""Integration tests for job search endpoints."""

import uuid
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.models.job_listing import JobListing
from app.services.dedup import job_content_hash, normalize


@pytest.fixture
async def sample_job(db_session):
    title = "Python Developer"
    company = "Acme Corp"
    location = "New York, NY"
    tn = normalize(title)
    cn = normalize(company)
    ln = normalize(location)
    job = JobListing(
        id=uuid.uuid4(),
        external_id="adzuna_12345",
        source="adzuna",
        title=title,
        company=company,
        location=location,
        is_remote=False,
        apply_url="https://example.com/apply",
        content_hash=job_content_hash(tn, cn, ln),
        title_normalized=tn,
        company_normalized=cn,
    )
    db_session.add(job)
    await db_session.commit()
    return job


@pytest.mark.asyncio
async def test_get_job(client: AsyncClient, sample_job: JobListing):
    response = await client.get(f"/v1/jobs/{sample_job.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == sample_job.title
    assert data["company"] == sample_job.company


@pytest.mark.asyncio
async def test_get_job_not_found(client: AsyncClient):
    response = await client.get(f"/v1/jobs/{uuid.uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_search_jobs_requires_query(client: AsyncClient):
    response = await client.get("/v1/jobs/")
    assert response.status_code == 422  # q is required


@pytest.mark.asyncio
async def test_search_returns_db_results_with_filters(client: AsyncClient, sample_job):
    """FR-001/FR-003: search + experience/salary filters (sources mocked out)."""
    # No external sources → aggregate falls straight through to the DB query.
    with patch("app.services.job_search.get_sources", return_value=[]):
        # Matches the seeded "Python Developer" (no seniority marker => mid)
        response = await client.get(
            "/v1/jobs/", params={"q": "Python", "experience": "mid"}
        )
        assert response.status_code == 200
        assert response.json()["meta"]["total"] == 1

        # Senior filter excludes it
        response = await client.get(
            "/v1/jobs/", params={"q": "Python", "experience": "senior"}
        )
        assert response.json()["meta"]["total"] == 0

        # Invalid experience value rejected
        response = await client.get(
            "/v1/jobs/", params={"q": "Python", "experience": "guru"}
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_dedup_hash_consistency():
    """Same title/company/location always produces the same hash."""
    h1 = job_content_hash(normalize("Python Dev"), normalize("Acme"), normalize("NYC"))
    h2 = job_content_hash(normalize("Python Dev"), normalize("Acme"), normalize("NYC"))
    assert h1 == h2


@pytest.mark.asyncio
async def test_dedup_hash_differs_on_different_input():
    h1 = job_content_hash(normalize("Python Dev"), normalize("Acme"), normalize("NYC"))
    h2 = job_content_hash(normalize("Java Dev"), normalize("Acme"), normalize("NYC"))
    assert h1 != h2
