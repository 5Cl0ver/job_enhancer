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
async def test_match_score_flow(client: AsyncClient, db_session, test_user, sample_job):
    """GET /jobs/{id}/match: no resume → flag; with resume → coverage lists."""
    import uuid as _uuid

    from app.models.resume import Resume

    # Give the listing a description that names skills.
    sample_job.description = (
        "Build web apps with Python and React on PostgreSQL. "
        "Docker deploys, code reviews, strong communication."
    )
    await db_session.commit()

    # No resume yet → has_resume False, score 0 (UI shows an upload prompt).
    r = await client.get(f"/v1/jobs/{sample_job.id}/match")
    assert r.status_code == 200
    assert r.json() == {
        "has_resume": False, "has_description": True,
        "score": 0, "matched": [], "missing": [],
    }

    # Active resume covering some of the keywords.
    db_session.add(
        Resume(
            id=_uuid.uuid4(),
            user_id=test_user.id,
            filename="resume.pdf",
            mime_type="application/pdf",
            file_size_bytes=100,
            extracted_text="Python developer, Postgres, Docker, clear communication.",
            is_active=True,
        )
    )
    await db_session.commit()

    r2 = await client.get(f"/v1/jobs/{sample_job.id}/match")
    body = r2.json()
    assert body["has_resume"] is True
    assert "python" in body["matched"]
    assert "postgresql" in body["matched"]  # postgres in resume counts
    assert "react" in body["missing"]
    assert 0 < body["score"] < 100


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
