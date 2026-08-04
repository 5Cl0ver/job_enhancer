"""Integration tests for admin endpoints: stats, health, role guard."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.models.user import User


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


# ---------------------------------------------------------------------------
# User management (promote/demote + remove)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_promote_then_demote_user(
    admin_client: AsyncClient, test_user: User
):
    # Promote the regular user to admin.
    resp = await admin_client.patch(
        f"/v1/admin/users/{test_user.id}", json={"role": "admin"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"

    # And demote back to a regular user.
    resp = await admin_client.patch(
        f"/v1/admin/users/{test_user.id}", json={"role": "user"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"


@pytest.mark.asyncio
async def test_admin_cannot_change_own_role(
    admin_client: AsyncClient, admin_user: User
):
    """Guards against the last admin locking themselves out."""
    resp = await admin_client.patch(
        f"/v1/admin/users/{admin_user.id}", json={"role": "user"}
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_update_role_rejects_invalid_role(
    admin_client: AsyncClient, test_user: User
):
    resp = await admin_client.patch(
        f"/v1/admin/users/{test_user.id}", json={"role": "superuser"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_admin_update_role_unknown_user_404(admin_client: AsyncClient):
    resp = await admin_client.patch(
        f"/v1/admin/users/{uuid.uuid4()}", json={"role": "admin"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_regular_user_cannot_manage_users(client: AsyncClient, admin_user: User):
    """FR-019: only admins may mutate users."""
    resp = await client.patch(
        f"/v1/admin/users/{admin_user.id}", json={"role": "admin"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_remove_user_soft_deletes(
    admin_client: AsyncClient, test_user: User
):
    resp = await admin_client.delete(f"/v1/admin/users/{test_user.id}")
    assert resp.status_code == 204

    # The removed user no longer appears in the (deleted-filtered) list.
    listing = await admin_client.get("/v1/admin/users")
    assert all(u["email"] != "user@test.dev" for u in listing.json())


@pytest.mark.asyncio
async def test_admin_cannot_remove_self(admin_client: AsyncClient, admin_user: User):
    resp = await admin_client.delete(f"/v1/admin/users/{admin_user.id}")
    assert resp.status_code == 400
