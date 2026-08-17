"""Email auto-status endpoints — connect an inbox and review detected updates.

Connect/read/disconnect live here now; the scan + per-event review actions are
added alongside once the IMAP fetch layer lands.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.detected_event import DetectedEvent
from app.models.email_account import STATUS_CONNECTED, STATUS_ERROR
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.email_account import (
    ConsideredOut,
    DetectedEventOut,
    EmailAccountOut,
    EmailConnectRequest,
    ProviderInfoOut,
    ScanResult,
)
from app.services import email_accounts as svc
from app.services import email_imap, email_review
from app.services.email_providers import detect_provider
from app.services.email_scan import detect_events, mail_link
from app.utils import crypto

router = APIRouter()


async def _events_out(
    db: AsyncSession, provider: str, events: list[DetectedEvent]
) -> list[DetectedEventOut]:
    """Enrich stored events with a link to the job in the app (job_listing_id)
    and a link to the email in webmail (built from provider + subject)."""
    if not events:
        return []
    ids = [e.saved_job_id for e in events]
    rows = (
        await db.execute(
            select(SavedJob.id, SavedJob.job_listing_id).where(SavedJob.id.in_(ids))
        )
    ).all()
    listing_of = {r.id: r.job_listing_id for r in rows}
    out: list[DetectedEventOut] = []
    for e in events:
        d = DetectedEventOut.model_validate(e)
        d.job_listing_id = listing_of.get(e.saved_job_id)
        d.mail_link = mail_link(provider, subject=e.subject)
        out.append(d)
    return out


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


@router.post("/scan", response_model=ScanResult)
async def scan_inbox(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResult:
    """Read the connected inbox and record any new detected updates (pending)."""
    account = await svc.get_account(db, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No email account connected")

    password = crypto.decrypt(account.secret_encrypted)
    try:
        messages = await email_imap.fetch_recent(
            account.imap_host,
            account.imap_port,
            account.email_address,
            password,
        )
    except email_imap.ImapAuthError:
        account.status = STATUS_ERROR
        account.last_error = "Login failed — check your app password."
        await db.commit()
        raise HTTPException(status_code=400, detail=account.last_error) from None
    except Exception:
        account.status = STATUS_ERROR
        account.last_error = "Could not reach the mail server."
        await db.commit()
        raise HTTPException(status_code=502, detail=account.last_error) from None

    result = await detect_events(db, account, messages)
    account.last_scan_at = datetime.now(tz=UTC)
    account.status = STATUS_CONNECTED
    account.last_error = None
    await db.commit()
    return ScanResult(
        detected=len(result.created),
        events=await _events_out(db, account.provider, result.created),
        considered=[ConsideredOut.model_validate(c) for c in result.considered],
        scanned=result.scanned,
        candidates=result.candidates,
        window_days=email_imap.DEFAULT_SINCE_DAYS,
    )


@router.get("/events", response_model=list[DetectedEventOut])
async def list_events(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DetectedEventOut]:
    """Detected updates awaiting review, newest first."""
    rows = await email_review.list_pending(db, user.id)
    account = await svc.get_account(db, user.id)
    return await _events_out(db, account.provider if account else "", rows)


@router.post("/events/{event_id}/apply", response_model=DetectedEventOut)
async def apply_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Approve a detected update — move the card to the target stage."""
    ev = await email_review.apply_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)


@router.post("/events/{event_id}/dismiss", response_model=DetectedEventOut)
async def dismiss_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Reject a detected update — move nothing."""
    ev = await email_review.dismiss_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)


@router.post("/events/{event_id}/undo", response_model=DetectedEventOut)
async def undo_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Reverse an applied update — put the card back where it was."""
    ev = await email_review.undo_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)
