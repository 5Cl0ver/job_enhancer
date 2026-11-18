"""Open one detected email from the user's mailbox, on demand, read-only.

The app stores where each detected email lives (folder + UIDVALIDITY + UID)
but not its text. When the user clicks "View email", this fetches just that
message with ``BODY.PEEK`` (never marks it read, moves or stores it) and
returns its cleaned plain text — email HTML is untrusted and is never sent to
the browser as HTML.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.services import email_sync
from app.services.email_imap import _parse_message
from app.services.email_sync import MessageRef
from app.services.email_text import clean_header
from app.utils import crypto

TEXT_LIMIT = 50_000


class EmailGone(Exception):
    """The email is no longer where it was (deleted, moved, mailbox rebuilt)."""


@dataclass
class ViewedEmail:
    subject: str
    from_addr: str
    date: datetime | None
    text: str
    read_issues: tuple[str, ...]


def _fetch_blocking(account: EmailAccount, ev: DetectedEvent) -> ViewedEmail:
    ref = MessageRef(ev.folder, "", ev.uidvalidity, int(ev.message_uid), kept=True)
    found: dict = {}

    def on_message(r, raw, issue):
        found["raw"], found["issue"] = raw, issue

    email_sync.fetch_refs(
        account.imap_host,
        account.imap_port,
        account.email_address,
        crypto.decrypt(account.secret_encrypted),
        [ref],
        on_message,
    )
    raw = found.get("raw")
    if raw is None:
        raise EmailGone(found.get("issue") or "vanished")
    msg = _parse_message(ev.message_uid, raw)
    if ev.uidvalidity is None and not _same_email(ev, msg.subject, msg.from_addr):
        # A row saved before folders were tracked: its UID may name another
        # email by now, so only a matching subject and sender count.
        raise EmailGone("vanished")
    return ViewedEmail(
        subject=msg.subject,
        from_addr=msg.from_addr,
        date=msg.date,
        text=(msg.body or "")[:TEXT_LIMIT],
        read_issues=msg.read_issues,
    )


def _same_email(ev: DetectedEvent, subject: str, from_addr: str) -> bool:
    return (
        clean_header(ev.subject) == clean_header(subject)[:500]
        and (ev.from_addr or "") == (from_addr or "")[:255]
    )


async def view_email(account: EmailAccount, ev: DetectedEvent) -> ViewedEmail:
    """Fetch the event's email (read-only). Raises EmailGone if it moved or was
    deleted, and the sync's own errors if the mailbox can't be reached."""
    if not str(ev.message_uid).isdigit():
        raise EmailGone("unknown_location")
    return await asyncio.to_thread(_fetch_blocking, account, ev)
