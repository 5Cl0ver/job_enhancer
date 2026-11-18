"""Parsing fetched IMAP data into plain objects — no network here.

``_parse_message`` turns a raw RFC822 message into an :class:`EmailMessage`
(never raising), ``parse_header_block`` decodes a header-only fetch for the
header-first filter, and ``read_stats`` counts how reading went. The socket
work — connecting, folders, cursors, fetching — lives in ``email_sync``.
"""

from __future__ import annotations

import contextlib
import email
import logging
from dataclasses import dataclass
from email.header import decode_header
from email.utils import parsedate_to_datetime

from app.services.email_prefilter import HeaderInfo
from app.services.email_scan import EmailMessage
from app.services.email_text import (
    BLANK,
    CHARSET_FALLBACK,
    HIDDEN_REMOVED,
    HTML_CONVERTED,
    LOSSY_DECODE,
    NO_TEXT_PART,
    PARSE_FAILED,
    QUOTE_FALLBACK,
    clean_header,
    decode_bytes,
    read_message,
)

logger = logging.getLogger("app.email_imap")


class ImapAuthError(Exception):
    """Login was rejected — usually a wrong/expired app-password."""


def _decode(value: str | None) -> str:
    """Decode a possibly MIME-encoded header (``=?utf-8?...?=``) to plain text.

    Raw 8-bit headers (UTF-8 sent without encoding) arrive as ``unknown-8bit``
    chunks; those and any bad charset go through the body's charset fallback
    instead of being replaced with U+FFFD.
    """
    if not value:
        return ""
    try:
        parts = decode_header(value)
    except Exception:  # noqa: BLE001 — malformed encoded-word
        return str(value)
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            declared = (
                None if (charset or "unknown-8bit") == "unknown-8bit" else charset
            )
            part, _ = decode_bytes(part, declared)
        out.append(part)
    return "".join(out)


def _parse_message(uid: str, raw: bytes) -> EmailMessage:
    """Turn a raw RFC822 message into the normalized shape the classifier wants.

    Never raises: anything unreadable comes back with ``parse_failed`` in
    ``read_issues`` (and whatever headers could be salvaged), so one bad
    message can't fail a whole scan.
    """
    try:
        msg = email.message_from_bytes(raw)
    except Exception:  # noqa: BLE001 — isolate a poison message
        logger.warning("email uid=%s could not be parsed", uid, exc_info=True)
        return EmailMessage(
            uid=uid, from_addr="", subject="", body="", read_issues=(PARSE_FAILED,)
        )
    headers = {
        "from_addr": clean_header(_decode(msg.get("From", ""))),
        "subject": clean_header(_decode(msg.get("Subject", ""))),
        "message_id": (msg.get("Message-ID") or "").strip(),
    }
    date = None
    with contextlib.suppress(Exception):
        date = parsedate_to_datetime(msg.get("Date", ""))
    try:
        text = read_message(msg)
    except Exception:  # noqa: BLE001 — isolate a poison message
        logger.warning("email uid=%s body could not be read", uid, exc_info=True)
        return EmailMessage(
            uid=uid, body="", date=date, read_issues=(PARSE_FAILED,), **headers
        )
    precedence = (msg.get("Precedence") or "").strip().lower()
    list_mail = bool(
        msg.get("List-Id")
        or msg.get("List-Unsubscribe")
        or precedence in {"bulk", "list"}
    )
    return EmailMessage(
        uid=uid,
        body=text.full,
        newest_text=text.newest,
        date=date,
        read_issues=text.issues,
        list_mail=list_mail,
        reply_to=clean_header(_decode(msg.get("Reply-To", ""))),
        **headers,
    )


@dataclass
class ReadStats:
    """How reading a batch of messages went — counts only, never content."""

    total: int = 0
    failed: int = 0  # couldn't be read at all
    blank: int = 0  # read fine but no text found
    blank_explained: int = 0  # ...because it had no text part (attachment-only)
    charset_fallback: int = 0
    lossy_decode: int = 0
    quote_fallback: int = 0
    html_converted: int = 0
    hidden_removed: int = 0

    @property
    def blank_unexplained(self) -> int:
        return self.blank - self.blank_explained


def read_stats(messages: list[EmailMessage]) -> ReadStats:
    stats = ReadStats(total=len(messages))
    for m in messages:
        issues = set(m.read_issues)
        stats.failed += PARSE_FAILED in issues
        stats.blank += BLANK in issues
        stats.blank_explained += BLANK in issues and NO_TEXT_PART in issues
        stats.charset_fallback += CHARSET_FALLBACK in issues
        stats.lossy_decode += LOSSY_DECODE in issues
        stats.quote_fallback += QUOTE_FALLBACK in issues
        stats.html_converted += HTML_CONVERTED in issues
        stats.hidden_removed += HIDDEN_REMOVED in issues
    return stats


def parse_header_block(raw: bytes) -> HeaderInfo:
    """Decode the header fields of a message (or of a header-only fetch)."""
    msg = email.message_from_bytes(raw)

    def field(name: str) -> str:
        return clean_header(_decode(msg.get(name, "")))

    return HeaderInfo(
        from_addr=field("From"),
        reply_to=field("Reply-To"),
        subject=field("Subject"),
        date=field("Date"),
        message_id=(msg.get("Message-ID") or "").strip(),
        list_id=field("List-Id"),
        list_unsubscribe=field("List-Unsubscribe"),
        auto_submitted=field("Auto-Submitted"),
        precedence=field("Precedence"),
    )
