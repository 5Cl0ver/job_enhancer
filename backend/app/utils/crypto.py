"""Symmetric encryption for secrets at rest (mailbox app-passwords).

Uses Fernet (AES-128-CBC + HMAC-SHA256, authenticated) from the ``cryptography``
library. The key comes from the ``MAIL_ENC_KEY`` env var — a url-safe base64
32-byte key generated once with ``Fernet.generate_key()`` and stored OUTSIDE the
repo. If it's unset we raise ``EncryptionUnavailable`` rather than fall back to
plaintext, so a misconfigured server can never persist a secret in the clear.
"""

from __future__ import annotations

from cryptography.fernet import Fernet

from app.config import settings


class EncryptionUnavailable(RuntimeError):
    """MAIL_ENC_KEY isn't configured — the email-connect feature stays off."""


def encryption_available() -> bool:
    """True when a key is configured (used to gate the connect endpoints)."""
    return bool(settings.mail_enc_key)


def _fernet() -> Fernet:
    key = settings.mail_enc_key
    if not key:
        raise EncryptionUnavailable(
            "MAIL_ENC_KEY is not set; email-account connections are disabled."
        )
    # Fernet accepts the base64 key as bytes. Build fresh each call so a rotated
    # key (or a test-injected one) takes effect without a process restart.
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> str:
    """Encrypt a secret; returns a url-safe token string safe to store in the DB."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    """Decrypt a token from :func:`encrypt`. Raises ``InvalidToken`` on tamper
    or a wrong/rotated key — callers treat that as a broken connection."""
    return _fernet().decrypt(token.encode()).decode()
