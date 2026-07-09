"""Integration tests for user account endpoints."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


@pytest.fixture
async def test_user(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="usertest@example.com",
        role="user",
    )
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.mark.asyncio
async def test_get_profile_unauthenticated(client: AsyncClient):
    response = await client.get("/api/v1/users/me")
    # Without valid auth token, should get 401 or 422
    assert response.status_code in (401, 403, 422)


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    """Health endpoint is always accessible."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
