"""Email auto-status endpoints — connect an inbox and review detected updates.

Connect/read/disconnect live here now; the scan + per-event review actions are
added alongside once the IMAP fetch layer lands.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.email_account import (
    EmailAccountOut,
    EmailConnectRequest,
    ProviderInfoOut,
)
from app.services import email_accounts as svc
from app.services.email_providers import detect_provider

router = APIRouter()


@router.get("/provider", response_model=ProviderInfoOut)
async def get_provider_for_address(
    address: str = Query(..., description="Email address to detect settings for"),
    user: User = Depends(get_current_user),
) -> ProviderInfoOut:
    """Tell the UI how to connect this address (which form/guide to show)."""
    return ProviderInfoOut(**detect_provider(address).as_dict())


@router.get("/account", response_model=EmailAccountOut | None)
async def get_connected_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut | None:
    """The user's connected inbox, or null if none."""
    account = await svc.get_account(db, user.id)
    return EmailAccountOut.model_validate(account) if account else None


@router.post("/connect", response_model=EmailAccountOut, status_code=201)
async def connect_account(
    data: EmailConnectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut:
    """Connect (or reconnect) a mailbox; the app-password is encrypted at rest."""
    account = await svc.connect_account(db, user.id, data)
    await db.commit()
    return EmailAccountOut.model_validate(account)


@router.delete("/account", status_code=204)
async def disconnect_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Disconnect the inbox and delete its detected events."""
    await svc.disconnect_account(db, user.id)
    await db.commit()
