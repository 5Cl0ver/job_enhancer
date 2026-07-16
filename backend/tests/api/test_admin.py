"""Integration tests for admin endpoints: stats, health, role guard."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_admin_stats_as_admin(admin_client: AsyncClient):
    response = await admin_client.get("/v1/admin/stats")
    assert response.status_code == 200
    stats = response.json()
    assert stats["total_users"] >= 1
    assert "signups_by_day" in stats


@pytest.mark.asyncio
async def test_admin_stats_forbidden_for_regular_user(client: AsyncClient):
    """FR-019: role-based access control."""
    response = await client.get("/v1/admin/stats")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_users_list(admin_client: AsyncClient):
    response = await admin_client.get("/v1/admin/users")
    assert response.status_code == 200
    users = response.json()
    assert any(u["email"] == "admin@test.dev" for u in users)


@pytest.mark.asyncio
async def test_admin_health_mocked(admin_client: AsyncClient):
    """FR-017: service health surface (external pings mocked)."""
    fake = [
        {"name": "database", "status": "healthy", "latency_ms": 2},
        {"name": "nvidia", "status": "healthy", "latency_ms": 120},
    ]
    with patch(
        "app.api.v1.admin.admin_service.check_service_health",
        new=AsyncMock(return_value=fake),
    ):
        response = await admin_client.get("/v1/admin/health")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_admin_endpoints_unauthenticated(anon_client: AsyncClient):
    response = await anon_client.get("/v1/admin/stats")
    assert response.status_code == 401
