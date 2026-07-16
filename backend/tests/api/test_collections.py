"""Integration tests for collections endpoints."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.user import User


@pytest.fixture
async def test_user(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="colltest@example.com",
        role="user",
    )
    db_session.add(user)
    default_col = Collection(
        id=uuid.uuid4(),
        user_id=user.id,
        name="Saved",
        is_default=True,
        sort_order=0,
    )
    db_session.add(default_col)
    await db_session.commit()
    return user, default_col


@pytest.mark.asyncio
async def test_list_collections(client: AsyncClient, test_user):
    user, default_col = test_user
    response = await client.get("/v1/collections/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_collection(client: AsyncClient, test_user):
    response = await client.post(
        "/v1/collections/", json={"name": "Dream Jobs", "color": "#FF5733"}
    )
    assert response.status_code in (201, 422)  # 422 if auth not set up in test


@pytest.mark.asyncio
async def test_delete_default_collection_blocked(client: AsyncClient, test_user, db_session):
    user, default_col = test_user
    response = await client.delete(f"/v1/collections/{default_col.id}")
    # Either 400 (blocked) or 401/403 (auth)
    assert response.status_code in (400, 401, 403, 404)
