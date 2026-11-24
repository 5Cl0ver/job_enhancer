"""Job Catcher one-press Connect, passes, hello and latest (spec 019)."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import extension as ext_api
from app.main import app
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.extension import (
    ExtensionConnectRequest,
    ExtensionInstall,
    ExtensionToken,
)
from app.models.user import User
from app.services import extension_connect as svc
from app.services import releases
from app.services.users import create_user
from app.utils.rate_limit import client_ip, rate_limit_key


@pytest_asyncio.fixture(autouse=True)
async def _fresh_limits():
    ext_api._limiter.reset()
    ext_api._ip_limiter.reset()
    releases.reset_cache()
    yield
    ext_api._limiter.reset()
    ext_api._ip_limiter.reset()
    releases.reset_cache()


async def _with_pass(c: AsyncClient, token: str, method: str, url: str, **kw):
    """A request as Job Catcher with its pass: the real auth, not the tests'
    stand-in user (the clients share the app's dependency overrides)."""
    saved = {
        dep: app.dependency_overrides.pop(dep)
        for dep in (get_current_user, get_user_or_pass)
        if dep in app.dependency_overrides
    }
    try:
        headers = {"Authorization": f"Bearer {token}"}
        return await c.request(method, url, headers=headers, **kw)
    finally:
        app.dependency_overrides.update(saved)


def _proof() -> tuple[str, str]:
    proof = secrets.token_urlsafe(32)
    return proof, hashlib.sha256(proof.encode()).hexdigest()


async def _start(c: AsyncClient) -> tuple[dict, str]:
    proof, proof_hash = _proof()
    r = await c.post("/v1/extension/connect/start", json={"proof_hash": proof_hash})
    assert r.status_code == 200, r.text
    return r.json(), proof


async def _connect(client: AsyncClient) -> str:
    """Start, approve and poll: the pass a Job Catcher would get."""
    started, proof = await _start(client)
    r = await client.post(
        "/v1/extension/connect/approve", json={"code": started["code"], "proof": proof}
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
    )
    body = r.json()
    assert body["status"] == "approved" and body["token"].startswith("jcx_")
    return body["token"]


@pytest.mark.asyncio
async def test_connect_flow_hands_the_pass_over_once(client: AsyncClient):
    started, proof = await _start(client)
    assert len(started["code"]) == 9 and started["expires_in"] > 250
    r = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
    )
    assert r.json() == {"status": "pending"}

    r = await client.post(
        "/v1/extension/connect/status", json={"code": started["code"]}
    )
    assert r.json()["status"] == "pending"

    r = await client.post(
        "/v1/extension/connect/approve", json={"code": started["code"], "proof": proof}
    )
    assert r.status_code == 200

    first = (
        await client.post(
            "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
        )
    ).json()
    assert first["status"] == "approved"
    assert first["email"] == "user@test.dev"
    assert first["token"].startswith("jcx_") and len(first["token"]) == 47

    again = (
        await client.post(
            "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
        )
    ).json()
    assert again == {"status": "used"}  # never handed out twice

    # Approving a used request: the same 404 as an unknown code.
    r = await client.post(
        "/v1/extension/connect/approve", json={"code": started["code"], "proof": proof}
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_wrong_proof_never_approves(client: AsyncClient):
    """Device-code phishing: someone else's link approved without the proof
    from the Job Catcher in this Chrome gets nothing, and looks like any 404."""
    started, _proof_right = await _start(client)
    r = await client.post(
        "/v1/extension/connect/approve",
        json={"code": started["code"], "proof": secrets.token_urlsafe(32)},
    )
    assert r.status_code == 404
    unknown = await client.post(
        "/v1/extension/connect/approve",
        json={"code": "ZZZZ-ZZZZ", "proof": secrets.token_urlsafe(32)},
    )
    assert unknown.status_code == 404 and unknown.json() == r.json()
    poll = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
    )
    assert poll.json() == {"status": "pending"}


@pytest.mark.asyncio
async def test_wrong_poll_token_and_expiry(
    client: AsyncClient, db_session: AsyncSession
):
    r = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": secrets.token_urlsafe(32)}
    )
    assert r.status_code == 404

    started, proof = await _start(client)
    req = await db_session.scalar(
        select(ExtensionConnectRequest).where(
            ExtensionConnectRequest.code == started["code"]
        )
    )
    req.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    r = await client.post(
        "/v1/extension/connect/approve", json={"code": started["code"], "proof": proof}
    )
    assert r.status_code == 404
    r = await client.post(
        "/v1/extension/connect/status", json={"code": started["code"]}
    )
    assert r.status_code == 404
    r = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
    )
    assert r.json() == {"status": "expired"}


@pytest.mark.asyncio
async def test_cancel_from_job_catcher_or_the_app(client: AsyncClient):
    started, proof = await _start(client)
    r = await client.post(
        "/v1/extension/connect/cancel", json={"poll_token": started["poll_token"]}
    )
    assert r.status_code == 200
    r = await client.post(
        "/v1/extension/connect/approve", json={"code": started["code"], "proof": proof}
    )
    assert r.status_code == 404

    started, _ = await _start(client)
    r = await client.post(
        "/v1/extension/connect/cancel", json={"code": started["code"]}
    )
    assert r.status_code == 200
    r = await client.post(
        "/v1/extension/connect/poll", json={"poll_token": started["poll_token"]}
    )
    assert r.json() == {"status": "cancelled"}


@pytest.mark.asyncio
async def test_the_pass_works_until_revoked(
    client: AsyncClient, anon_client: AsyncClient, db_session: AsyncSession
):
    token = await _connect(client)
    me = await _with_pass(anon_client, token, "GET", "/v1/users/me")
    assert me.status_code == 200 and me.json()["email"] == "user@test.dev"

    # Signing out in Job Catcher revokes its own pass.
    r = await _with_pass(anon_client, token, "DELETE", "/v1/extension/tokens/current")
    assert r.status_code == 204
    me = await _with_pass(anon_client, token, "GET", "/v1/users/me")
    assert me.status_code == 401

    # Disconnecting from the app revokes it at once too.
    token2 = await _connect(client)
    listed = (await client.get("/v1/extension/tokens")).json()
    assert len(listed) == 1
    r = await client.delete(f"/v1/extension/tokens/{listed[0]['id']}")
    assert r.status_code == 204
    me = await _with_pass(anon_client, token2, "GET", "/v1/users/me")
    assert me.status_code == 401
    bogus = await _with_pass(anon_client, "jcx_" + "x" * 43, "GET", "/v1/users/me")
    assert bogus.status_code == 401


@pytest.mark.asyncio
async def test_idle_and_old_passes_stop_working(
    client: AsyncClient, anon_client: AsyncClient, db_session: AsyncSession
):
    token = await _connect(client)
    row = await db_session.scalar(
        select(ExtensionToken).where(
            ExtensionToken.token_hash == svc.hash_secret(token)
        )
    )
    row.last_used_at = datetime.now(UTC) - timedelta(days=91)
    await db_session.commit()
    me = await _with_pass(anon_client, token, "GET", "/v1/users/me")
    assert me.status_code == 401

    row.last_used_at = datetime.now(UTC)
    row.created_at = datetime.now(UTC) - timedelta(days=366)
    await db_session.commit()
    me = await _with_pass(anon_client, token, "GET", "/v1/users/me")
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_at_most_ten_computers(client: AsyncClient, anon_client: AsyncClient):
    first = await _connect(client)
    for _ in range(4):
        await _connect(client)
    ext_api._ip_limiter.reset()  # start and approve allow 10 an hour
    ext_api._limiter.reset()
    for _ in range(6):
        await _connect(client)
    assert len((await client.get("/v1/extension/tokens")).json()) == 10
    r = await _with_pass(anon_client, first, "GET", "/v1/users/me")
    assert r.status_code == 401  # the oldest was disconnected


@pytest.mark.asyncio
async def test_job_catcher_cannot_approve_or_manage_connections(
    client: AsyncClient, anon_client: AsyncClient
):
    token = await _connect(client)
    started, proof = await _start(anon_client)
    r = await _with_pass(
        anon_client,
        token,
        "POST",
        "/v1/extension/connect/approve",
        json={"code": started["code"], "proof": proof},
    )
    assert r.status_code == 401  # only the app itself can approve
    r = await _with_pass(anon_client, token, "GET", "/v1/extension/tokens")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_someone_elses_connection_cannot_be_revoked(
    client: AsyncClient, db_session: AsyncSession
):
    other = await create_user(db_session, email="other@test.dev", name="Other")
    row = ExtensionToken(user_id=other.id, token_hash="a" * 64)
    db_session.add(row)
    await db_session.commit()
    r = await client.delete(f"/v1/extension/tokens/{row.id}")
    assert r.status_code == 404
    await db_session.refresh(row)
    assert row.revoked_at is None


@pytest.mark.asyncio
async def test_connect_start_is_rate_limited(anon_client: AsyncClient):
    for _ in range(10):
        await _start(anon_client)
    _, proof_hash = _proof()
    r = await anon_client.post(
        "/v1/extension/connect/start", json={"proof_hash": proof_hash}
    )
    assert r.status_code == 429


def test_rate_limit_key_never_uses_the_pass_itself():
    class _Req:
        headers = {"Authorization": "Bearer jcx_secretsecretsecret"}
        client = None

    key = rate_limit_key(_Req())  # type: ignore[arg-type]
    assert key.startswith("ext:") and "secret" not in key and len(key) == 16


@pytest.mark.asyncio
async def test_hello_records_the_version_and_the_update_note(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    async def fake_fetch():
        return releases._empty() | {"version": "0.35.0", "notes": "New"}

    monkeypatch.setattr(releases, "_fetch", fake_fetch)
    body = {
        "install_id": "install-abc123",
        "version": "0.34.1",
        "browser": "Chrome 142",
    }
    r = await client.post("/v1/extension/hello", json=body)
    assert r.json() == {"latest": "0.35.0", "update_available": True}
    r = await client.post("/v1/extension/hello", json=body | {"version": "0.35.0"})
    assert r.json()["update_available"] is False

    bad = await client.post("/v1/extension/hello", json=body | {"version": "1;drop"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_latest_is_cached_and_survives_github_being_down(
    anon_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if "latest.json" in str(request.url):
            return httpx.Response(200, json={"notes": "Connect", "sha256": "ab" * 32})
        return httpx.Response(
            200,
            json=[
                {"tag_name": "v9.9.9", "assets": []},  # not Job Catcher
                {
                    "tag_name": "job-catcher-v0.34.1",
                    "body": "old",
                    "assets": [],
                },
                {
                    "tag_name": "job-catcher-v0.35.0",
                    "body": "notes",
                    "published_at": "2026-11-24T00:00:00Z",
                    "assets": [
                        {
                            "name": "latest.json",
                            "browser_download_url": "https://example.test/latest.json",
                        }
                    ],
                },
            ],
        )

    real = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(releases.httpx, "AsyncClient", fake_client)
    r = (await anon_client.get("/v1/extension/latest")).json()
    assert r["version"] == "0.35.0"
    assert r["notes"] == "Connect" and r["sha256"] == "ab" * 32
    assert r["download_url"].endswith("/releases/latest/download/job-catcher.zip")
    seen = calls["n"]
    await anon_client.get("/v1/extension/latest")
    assert calls["n"] == seen  # cached

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    def down_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(down)
        return real(*args, **kwargs)

    monkeypatch.setattr(releases.httpx, "AsyncClient", down_client)
    releases._cache["next"] = 0.0  # cache ran out
    r = (await anon_client.get("/v1/extension/latest")).json()
    assert r["version"] == "0.35.0"  # last known answer stands


@pytest.mark.asyncio
async def test_export_lists_connections_without_secrets_and_delete_cascades(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    token = await _connect(client)
    await client.post(
        "/v1/extension/hello",
        json={"install_id": "install-abc123", "version": "0.35.0"},
    )
    export = (await client.get("/v1/users/me/export")).text
    assert "job_catcher_connections" in export and "job_catcher_installs" in export
    assert token not in export and svc.hash_secret(token) not in export

    # Deleting the account deletes these (Postgres cascades; SQLite tests
    # don't enforce foreign keys, so check the declared rule).
    for model in (ExtensionToken, ExtensionInstall, ExtensionConnectRequest):
        fk = next(iter(model.__table__.c.user_id.foreign_keys))
        assert fk.ondelete == "CASCADE"


def test_versions_compare_as_numbers():
    assert releases.is_older("0.9.0", "0.10.0")
    assert not releases.is_older("0.35.0", "0.35.0")
    assert not releases.is_older(None, "0.35.0")
    assert app is not None


def test_client_ip_trusts_only_what_the_proxy_added():
    class _Req:
        def __init__(self, peer, forwarded=""):
            self.client = type("C", (), {"host": peer})()
            self.headers = {"x-forwarded-for": forwarded} if forwarded else {}

    # Behind Render's proxy (a private peer): the rightmost hop is the client;
    # whatever the client typed to its left is ignored.
    assert client_ip(_Req("10.1.2.3", "6.6.6.6, 203.0.113.9")) == "203.0.113.9"
    assert client_ip(_Req("10.1.2.3", "203.0.113.9")) == "203.0.113.9"
    # A public peer is the client itself; its forwarded header is ignored.
    assert client_ip(_Req("8.8.4.4", "6.6.6.6")) == "8.8.4.4"
    assert client_ip(_Req("10.1.2.3", "not-an-ip")) == "10.1.2.3"


@pytest.mark.asyncio
async def test_start_says_busy_when_too_many_wait(
    anon_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(svc, "MAX_PENDING", 2)
    await _start(anon_client)
    await _start(anon_client)
    _, proof_hash = _proof()
    r = await anon_client.post(
        "/v1/extension/connect/start", json={"proof_hash": proof_hash}
    )
    assert r.status_code == 503 and "Busy" in r.text


@pytest.mark.asyncio
async def test_password_reset_disconnects_every_job_catcher(
    client: AsyncClient, anon_client: AsyncClient
):
    first = await _connect(client)
    second = await _connect(client)
    r = await client.post("/v1/extension/tokens/revoke-all")
    assert r.json() == {"revoked": 2}
    for token in (first, second):
        me = await _with_pass(anon_client, token, "GET", "/v1/users/me")
        assert me.status_code == 401
    # Only the app itself can do it.
    third = await _connect(client)
    r = await _with_pass(anon_client, third, "POST", "/v1/extension/tokens/revoke-all")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_installs_show_password_sign_ins_too(client: AsyncClient):
    await client.post(
        "/v1/extension/hello",
        json={
            "install_id": "install-abc123",
            "version": "0.35.0",
            "browser": "Edge 142",
        },
    )
    rows = (await client.get("/v1/extension/installs")).json()
    assert [(r["version"], r["browser"]) for r in rows] == [("0.35.0", "Edge 142")]


@pytest.mark.asyncio
async def test_release_failures_are_logged_once(
    anon_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    async def down():
        raise httpx.ConnectError("down")

    monkeypatch.setattr(releases, "_fetch", down)
    for _ in range(3):
        releases._cache["next"] = 0.0
        await anon_client.get("/v1/extension/latest")
    warnings = [r for r in caplog.records if "release check failed" in r.getMessage()]
    assert len(warnings) == 1
