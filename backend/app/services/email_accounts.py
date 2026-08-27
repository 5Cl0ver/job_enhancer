"""Connect / read / disconnect a user's mailbox for email auto-status.

Owns the encrypted-credential lifecycle: it detects the right IMAP settings for
an address, encrypts the app-password with ``app.utils.crypto`` before storing,
and enforces one connected inbox per user (connecting again updates in place).
The plaintext secret exists only in the request and in memory during a scan.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_account import AUTH_APP_PASSWORD, STATUS_CONNECTED, EmailAccount
from app.schemas.email_account import EmailConnectRequest
from app.services.email_providers import FORWARD, detect_provider
from app.utils import crypto


async def get_account(db: AsyncSession, user_id: uuid.UUID) -> EmailAccount | None:
    return await db.scalar(select(EmailAccount).where(EmailAccount.user_id == user_id))


async def connect_account(
    db: AsyncSession, user_id: uuid.UUID, data: EmailConnectRequest
) -> EmailAccount:
    """Store (or update) the user's IMAP credentials, encrypted at rest."""
    if not crypto.encryption_available():
        # Server isn't configured with an encryption key — refuse rather than
        # store a plaintext secret.
        raise HTTPException(
            status_code=503,
            detail="Email connections are not enabled on this server.",
        )

    preset = detect_provider(data.email_address)
    host = data.imap_host or preset.imap_host
    port = data.imap_port or preset.imap_port

    if preset.connect_method == FORWARD and not data.imap_host:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{preset.label} has no direct IMAP access. Use email "
                "forwarding instead, or enter a custom IMAP host."
            ),
        )
    if not host:
        raise HTTPException(
            status_code=400,
            detail="An IMAP host is required for this provider.",
        )

    secret = crypto.encrypt(data.app_password)

    account = await get_account(db, user_id)
    if account is None:
        account = EmailAccount(id=uuid.uuid4(), user_id=user_id)
        db.add(account)

    account.email_address = str(data.email_address)
    account.provider = preset.provider
    account.auth_type = AUTH_APP_PASSWORD
    account.imap_host = host
    account.imap_port = port
    account.secret_encrypted = secret
    account.status = STATUS_CONNECTED
    account.last_error = None
    await db.flush()
    return account


async def disconnect_account(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Remove the connection and (via cascade) its detected events."""
    account = await get_account(db, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No email account connected")
    await db.delete(account)
    await db.flush()
