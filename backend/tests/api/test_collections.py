"""Integration tests for collections endpoints (CRUD + default protection)."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_collections_has_default(client: AsyncClient):
    response = await client.get("/v1/collections/")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Saved"
    assert data[0]["is_default"] is True


@pytest.mark.asyncio
async def test_create_rename_delete_collection(client: AsyncClient):
    # Create
    response = await client.post(
        "/v1/collections/", json={"name": "Dream Jobs", "color": "#FF5733"}
    )
    assert response.status_code == 201
    collection = response.json()
    assert collection["name"] == "Dream Jobs"

    # Rename (FR-005)
    response = await client.patch(
        f"/v1/collections/{collection['id']}", json={"name": "Top Picks"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Top Picks"

    # Delete
    response = await client.delete(f"/v1/collections/{collection['id']}")
    assert response.status_code == 204

    response = await client.get("/v1/collections/")
    names = [c["name"] for c in response.json()]
    assert "Top Picks" not in names


@pytest.mark.asyncio
async def test_duplicate_collection_name_rejected(client: AsyncClient):
    first = await client.post("/v1/collections/", json={"name": "Startups"})
    assert first.status_code == 201
    duplicate = await client.post("/v1/collections/", json={"name": "Startups"})
    assert duplicate.status_code in (400, 409)


@pytest.mark.asyncio
async def test_delete_default_collection_blocked(client: AsyncClient):
    response = await client.get("/v1/collections/")
    default = next(c for c in response.json() if c["is_default"])

    response = await client.delete(f"/v1/collections/{default['id']}")
    assert response.status_code == 400
