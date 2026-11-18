"""Persisting sync state: per-folder cursors, known duplicate keys, backoff.

The database side of ``email_sync``: load what a scan needs before connecting
(cursors, already-detected locations and EMAILIDs) and save cursors plus
backoff afterwards — in the caller's transaction, so cursors and detected
events always commit together.
"""

from __future__ import annotations

import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.models.email_folder_state import EmailFolderState
from app.services.email_sync import FolderCursor, SyncResult

BACKOFF_MAX_LEVEL = 7  # 1, 2, 4 … minutes, capped at 60
BACKOFF_MAX_MINUTES = 60


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)  # SQLite returns naive datetimes
    return dt


async def load_cursors(
    db: AsyncSession, account_id: uuid.UUID
) -> dict[str, FolderCursor]:
    rows = await db.scalars(
        select(EmailFolderState).where(EmailFolderState.email_account_id == account_id)
    )
    return {
        r.folder_name: FolderCursor(
            folder=r.folder_name,
            role=r.role,
            uidvalidity=r.uidvalidity,
            last_uid=r.last_uid,
            backfill_low=r.backfill_low,
            backfill_floor=r.backfill_floor,
        )
        for r in rows
    }


async def known_keys(
    db: AsyncSession, account_id: uuid.UUID
) -> tuple[set[tuple[str, int, str]], set[str]]:
    """(folder, uidvalidity, uid) locations and raw EMAILIDs already detected,
    so the sync skips their body downloads."""
    rows = (
        await db.execute(
            select(
                DetectedEvent.folder,
                DetectedEvent.uidvalidity,
                DetectedEvent.message_uid,
                DetectedEvent.logical_key,
            ).where(DetectedEvent.email_account_id == account_id)
        )
    ).all()
    locations = {
        (r.folder, r.uidvalidity, r.message_uid)
        for r in rows
        if r.uidvalidity is not None
    }
    email_ids = {
        r.logical_key.removeprefix("emailid:")
        for r in rows
        if r.logical_key and r.logical_key.startswith("emailid:")
    }
    return locations, email_ids


async def save_cursors(
    db: AsyncSession, account_id: uuid.UUID, result: SyncResult, now: datetime
) -> None:
    existing = {
        r.folder_name: r
        for r in await db.scalars(
            select(EmailFolderState).where(
                EmailFolderState.email_account_id == account_id
            )
        )
    }
    report_of = {r.folder_role: r for r in result.reports}
    for name, cur in result.cursors.items():
        row = existing.get(name)
        if row is None:
            row = EmailFolderState(
                id=uuid.uuid4(), email_account_id=account_id, folder_name=name
            )
            db.add(row)
        row.role = cur.role
        row.uidvalidity = cur.uidvalidity
        row.last_uid = cur.last_uid
        row.backfill_low = cur.backfill_low
        row.backfill_floor = cur.backfill_floor
        row.last_scan_at = now
        report = report_of.get(cur.role)
        if report is not None:
            row.last_status = report.status
            row.last_report = report.as_dict()


def backoff_until(account: EmailAccount, now: datetime) -> datetime | None:
    """When the account may scan again, or None if it may scan now."""
    until = _aware(account.sync_backoff_until)
    return until if until and until > now else None


def apply_backoff(
    account: EmailAccount, now: datetime, rng: random.Random | None = None
) -> datetime:
    level = min((account.sync_backoff_level or 0) + 1, BACKOFF_MAX_LEVEL)
    minutes = min(BACKOFF_MAX_MINUTES, 2 ** (level - 1))
    jitter = (rng or random).uniform(0.8, 1.2)
    account.sync_backoff_level = level
    account.sync_backoff_until = now + timedelta(minutes=minutes * jitter)
    return account.sync_backoff_until


def clear_backoff(account: EmailAccount) -> None:
    account.sync_backoff_level = 0
    account.sync_backoff_until = None
