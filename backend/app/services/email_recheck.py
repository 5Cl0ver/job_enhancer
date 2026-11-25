"""Re-check the last few weeks of email with today's rules (spec 027).

A scan only re-reads the last couple of days, so an email a scan got wrong
stayed wrong. The re-check reads a whole window again (inbox + spam, from
empty cursors, nothing saved to them), skips every email already stored, and
records the rest with today's rules. It never moves a card: what would have
been a move waits for the user, and the rest is kept on its job or under
"Looked at, not shown".

It takes minutes, longer than a web request, so it runs in the background
under the account's scan lock; its progress is kept in memory per account
(a restart forgets it, and the user can press Re-check again).
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from app.models.email_account import EmailAccount
from app.services import email_sync, email_sync_state
from app.services.email_prefilter import company_tokens
from app.services.email_scan import _candidate_jobs, detect_events
from app.utils import crypto

logger = logging.getLogger(__name__)

MAX_DAYS = 45
_STATE: dict[uuid.UUID, dict] = {}
_TASKS: set[asyncio.Task] = set()


def status(account_id: uuid.UUID) -> dict:
    return _STATE.get(account_id) or {"state": "idle"}


def start(session_maker, account_id: uuid.UUID, days: int, lock: asyncio.Lock) -> dict:
    """Start a re-check of ``days`` days in the background."""
    _STATE[account_id] = {
        "state": "running",
        "days": days,
        "started_at": datetime.now(tz=UTC).isoformat(),
    }
    task = asyncio.create_task(_run(session_maker, account_id, days, lock))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return _STATE[account_id]


async def _run(session_maker, account_id: uuid.UUID, days: int, lock) -> None:
    async with lock:
        try:
            async with session_maker() as db:
                account = await db.get(EmailAccount, account_id)
                if account is None:
                    raise LookupError("no account")
                jobs = await _candidate_jobs(db, account.user_id)
                locations, email_ids = await email_sync_state.known_keys(db, account.id)
                opts = email_sync.SyncOptions(
                    backfill_days=days,
                    recheck_days=0,
                    body_cap=None,
                    time_budget_s=None,
                    saved_companies=company_tokens([j["company"] for j in jobs]),
                    known_locations=locations,
                    known_email_ids=email_ids,
                )
                result = await email_sync.sync_mailbox(
                    account.imap_host,
                    account.imap_port,
                    account.email_address,
                    crypto.decrypt(account.secret_encrypted),
                    {},  # the whole window; the saved cursors are left alone
                    opts,
                )
                detected = await detect_events(db, account, result.messages)
                await db.commit()
            _STATE[account_id] = {
                "state": "done",
                "days": days,
                "finished_at": datetime.now(tz=UTC).isoformat(),
                "read": sum(r.headers_read for r in result.reports),
                "found": len(detected.created)
                + len(detected.noted)
                + len(detected.review),
                "waiting": len(detected.created) + len(detected.review),
                "noted": len(detected.noted),
                "looked_at": len(detected.looked_at),
                "interrupted": result.interrupted,
            }
        except Exception:  # noqa: BLE001 - the page says it failed, try again
            logger.exception("email re-check failed")
            _STATE[account_id] = {"state": "failed", "days": days}
