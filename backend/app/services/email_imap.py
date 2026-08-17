"""IMAP fetch — the one place that talks to a real mailbox.

All network/protocol code is quarantined here so the rest of the feature stays
pure and unit-testable. We connect over SSL, read the inbox **read-only** (we
never delete, move, or mark anything in the user's mailbox), pull the most
recent messages, and hand back plain :class:`EmailMessage` objects for the
classifier. The RFC822 → EmailMessage parsing is a pure helper (``_parse_message``)
so it can be tested without a server; the socket work (``_fetch_sync``) is only
exercised live.
"""

from __future__ import annotations

import asyncio
import contextlib
import email
import imaplib
from email.header import decode_header, make_header
from email.message import Message

from app.services.email_scan import EmailMessage

# Only look at this many most-recent messages per scan. Job replies land in the
# recent window; older mail is already reflected on the board.
DEFAULT_LIMIT = 40


class ImapAuthError(Exception):
    """Login was rejected — usually a wrong/expired app-password."""


def _decode(value: str | None) -> str:
    """Decode a possibly MIME-encoded header (``=?utf-8?...?=``) to plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _body_text(msg: Message) -> str:
    """Best-effort plain-text body — prefer text/plain, fall back to html bytes."""
    if msg.is_multipart():
        for part in msg.walk():
            disp = str(part.get("Content-Disposition", ""))
            if part.get_content_type() == "text/plain" and "attachment" not in disp:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, "replace")
        return ""
    payload = msg.get_payload(decode=True)
    if payload:
        return payload.decode(msg.get_content_charset() or "utf-8", "replace")
    return ""


def _parse_message(uid: str, raw: bytes) -> EmailMessage:
    """Turn a raw RFC822 message into the normalized shape the classifier wants."""
    msg = email.message_from_bytes(raw)
    return EmailMessage(
        uid=uid,
        from_addr=_decode(msg.get("From", "")),
        subject=_decode(msg.get("Subject", "")),
        body=_body_text(msg),
    )


def _fetch_sync(
    host: str, port: int, address: str, password: str, limit: int
) -> list[EmailMessage]:
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        try:
            conn.login(address, password)
        except imaplib.IMAP4.error as exc:
            raise ImapAuthError(str(exc)) from exc
        # readonly=True — a strict guarantee we never modify the mailbox.
        conn.select("INBOX", readonly=True)
        _, data = conn.uid("search", None, "ALL")
        uids = data[0].split()[-limit:]
        out: list[EmailMessage] = []
        for uid in reversed(uids):  # newest first
            _, msg_data = conn.uid("fetch", uid, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            out.append(_parse_message(uid.decode(), msg_data[0][1]))
        return out
    finally:
        with contextlib.suppress(Exception):
            conn.logout()


async def fetch_recent(
    host: str,
    port: int,
    address: str,
    password: str,
    *,
    limit: int = DEFAULT_LIMIT,
) -> list[EmailMessage]:
    """Fetch recent inbox messages without blocking the event loop.

    ``imaplib`` is synchronous, so we run it in a worker thread. Raises
    :class:`ImapAuthError` on bad credentials; other failures (DNS, TLS, timeout)
    surface as the underlying exception for the caller to translate.
    """
    return await asyncio.to_thread(_fetch_sync, host, port, address, password, limit)
