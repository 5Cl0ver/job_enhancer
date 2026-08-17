"""API tests for connecting an inbox (email auto-status)."""

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.models.email_account import EmailAccount
from app.utils import crypto


@pytest_asyncio.fixture
def enc_key(monkeypatch):
    """Configure a real encryption key so /connect is enabled during tests."""
    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


@pytest.mark.asyncio
class TestProviderDetect:
    async def test_detects_yahoo(self, client):
        r = await client.get("/v1/email/provider", params={"address": "a@yahoo.com"})
        assert r.status_code == 200
        assert r.json()["provider"] == "yahoo"
        assert r.json()["connect_method"] == "app_password"

    async def test_requires_auth(self, anon_client):
        r = await anon_client.get(
            "/v1/email/provider", params={"address": "a@yahoo.com"}
        )
        assert r.status_code == 401


@pytest.mark.asyncio
class TestConnect:
    async def test_connect_stores_encrypted_secret(
        self, client, db_session, test_user, enc_key
    ):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "abcd-efgh"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["provider"] == "yahoo"
        assert body["imap_host"] == "imap.mail.yahoo.com"
        # The secret is never echoed back.
        assert "app_password" not in body
        assert "secret_encrypted" not in body

        # Stored form is ciphertext, and it decrypts back to the input.
        acct = await db_session.scalar(
            select(EmailAccount).where(EmailAccount.user_id == test_user.id)
        )
        assert acct.secret_encrypted != "abcd-efgh"
        assert crypto.decrypt(acct.secret_encrypted) == "abcd-efgh"

    async def test_reconnect_updates_in_place(self, client, db_session, enc_key):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "one"},
        )
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "two"},
        )
        assert r.status_code == 201
        accts = (await db_session.scalars(select(EmailAccount))).all()
        assert len(accts) == 1  # updated, not duplicated
        assert crypto.decrypt(accts[0].secret_encrypted) == "two"

    async def test_connect_disabled_without_key(self, client, monkeypatch):
        monkeypatch.setattr(settings, "mail_enc_key", "")
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "x"},
        )
        assert r.status_code == 503

    async def test_proton_without_host_rejected(self, client, enc_key):
        r = await client.post(
            "/v1/email/connect",
            json={"email_address": "me@proton.me", "app_password": "x"},
        )
        assert r.status_code == 400


@pytest.mark.asyncio
class TestAccountLifecycle:
    async def test_account_null_when_not_connected(self, client):
        r = await client.get("/v1/email/account")
        assert r.status_code == 200
        assert r.json() is None

    async def test_get_then_disconnect(self, client, db_session, enc_key):
        await client.post(
            "/v1/email/connect",
            json={"email_address": "me@yahoo.com", "app_password": "pw"},
        )
        got = await client.get("/v1/email/account")
        assert got.status_code == 200
        assert got.json()["email_address"] == "me@yahoo.com"

        deleted = await client.delete("/v1/email/account")
        assert deleted.status_code == 204
        assert (await db_session.scalars(select(EmailAccount))).all() == []

    async def test_disconnect_when_none_is_404(self, client):
        r = await client.delete("/v1/email/account")
        assert r.status_code == 404
