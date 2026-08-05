"""Integration tests for user account endpoints (profile, export, delete)."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


@pytest.mark.asyncio
async def test_health_endpoint(anon_client: AsyncClient):
    """Health endpoint is always accessible."""
    response = await anon_client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_get_profile_unauthenticated(anon_client: AsyncClient):
    response = await anon_client.get("/v1/users/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_profile(client: AsyncClient, test_user: User):
    response = await client.get("/v1/users/me")
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == test_user.email
    assert data["role"] == "user"
    assert data["follow_up_days"] == 7


@pytest.mark.asyncio
async def test_update_profile_follow_up_days(client: AsyncClient):
    response = await client.patch("/v1/users/me", json={"follow_up_days": 14})
    assert response.status_code == 200
    assert response.json()["follow_up_days"] == 14


@pytest.mark.asyncio
async def test_export_data(client: AsyncClient, test_user: User):
    response = await client.get("/v1/users/me/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert data["user"]["email"] == test_user.email
    # Seeded defaults are included
    assert len(data["collections"]) == 1
    assert len(data["pipeline_stages"]) == 8


@pytest.mark.asyncio
async def test_delete_account_soft_deletes(
    client: AsyncClient, test_user: User, db_session: AsyncSession
):
    response = await client.delete("/v1/users/me")
    assert response.status_code == 204

    user = await db_session.scalar(select(User).where(User.id == test_user.id))
    assert user is not None
    assert user.deleted_at is not None  # purged permanently after grace period


# ---------------------------------------------------------------------------
# Application profile ("profile vault" — feeds ATS autofill)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_application_profile_empty_then_upsert(client: AsyncClient):
    # Never filled → empty defaults, not a 404 (the Settings form just renders blank).
    r = await client.get("/v1/users/me/application-profile")
    assert r.status_code == 200
    assert r.json()["first_name"] is None
    assert r.json()["authorized_to_work"] is None

    # Partial save.
    r = await client.put(
        "/v1/users/me/application-profile",
        json={
            "first_name": "Fabian",
            "phone": "555-0100",
            "linkedin_url": "https://linkedin.com/in/fabian",
            "authorized_to_work": True,
            "requires_sponsorship": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["first_name"] == "Fabian"
    assert body["authorized_to_work"] is True

    # A later partial save must NOT wipe earlier answers.
    r = await client.put(
        "/v1/users/me/application-profile", json={"city": "Los Angeles"}
    )
    body = r.json()
    assert body["city"] == "Los Angeles"
    assert body["first_name"] == "Fabian"  # still there
    assert body["requires_sponsorship"] is False  # still there


@pytest.mark.asyncio
async def test_application_profile_rejects_bad_url(client: AsyncClient):
    r = await client.put(
        "/v1/users/me/application-profile",
        json={"github_url": "javascript:alert(1)"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_export_includes_application_profile(client: AsyncClient):
    await client.put(
        "/v1/users/me/application-profile", json={"first_name": "Fabian"}
    )
    data = (await client.get("/v1/users/me/export")).json()
    assert data["application_profile"]["first_name"] == "Fabian"
