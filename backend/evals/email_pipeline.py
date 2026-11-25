"""The email pipeline as the scorecard sees it: raw message → prediction.

One thin adapter over the production code (``email_imap._parse_message`` →
``classify`` → ``email_match.match_job``), so the
synthetic scorecard, the real-email export, and the known-bug tests all score
exactly what a scan would do. When a later phase changes those APIs, this is the
one place to update.

The matcher runs on every email (not only on classified ones) so job-matching
accuracy is measured on its own; ``surfaced`` says whether a real scan would
create a pending card move from the prediction.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from html.parser import HTMLParser

from app.services.email_classify import (
    APPLIED,
    INTERVIEW,
    RECRUITER,
    REJECTED,
    UNKNOWN,
    classify,
    stage_for_event,
)
from app.services.email_imap import _parse_message, parse_header_block
from app.services.email_match import (
    JobMatch,
    looks_like_digest,
    match_job,
    match_template,
    sender_is_saved_company,
)
from app.services.email_prefilter import company_tokens, possible_job_email
from app.services.email_scan import EmailMessage
from app.services.email_templates import IGNORE, read_template

# Labels the scorecard knows about. UNSURE (weak/conflicting evidence, no card
# move) and ERROR (a crash) are prediction-only labels.
OFFER = "offer"
ASSESSMENT = "assessment"
UNSURE = "unsure"
ERROR = "error"
EVENT_LABELS = [APPLIED, INTERVIEW, ASSESSMENT, OFFER, REJECTED, RECRUITER, UNKNOWN]
# The card move each event *should* cause (default pipeline stage names). Email
# type and card action are scored separately: an interview reminder is still an
# "interview" email but should not move the card.
EXPECTED_STAGE: dict[str, str] = {
    APPLIED: "Applied",
    INTERVIEW: "Interview",
    ASSESSMENT: "Take-Home Assignment",
    OFFER: "Offer",
    REJECTED: "Rejected",
}


@dataclass
class Prediction:
    event: str  # classifier output, or ERROR if parsing/classifying raised
    job_id: str | None  # matcher's pick (the job dict's ``id``), or None
    surfaced: bool  # would a real scan create a pending card move?
    action: str | None = None  # stage of that pending move, if surfaced
    body_blank: bool = False  # parsed body came back empty
    error: str | None = None  # exception class name when event == ERROR
    read_issues: tuple[str, ...] = ()  # from the reader (charset_fallback, …)
    filtered: bool = False  # dropped by the header filter (never classified)
    filter_reason: str = ""
    match_status: str = "none"  # matched | review | none
    match_evidence: str = ""  # which evidence decided (or the review reason)


def predict_message(msg: EmailMessage, jobs: list[dict]) -> Prediction:
    """Run an already-parsed message through classify + match."""
    try:
        verdict = classify(
            msg.subject,
            msg.classify_text,
            msg.from_addr,
            bulk=msg.list_mail,
            job_sender=sender_is_saved_company(jobs, msg.from_addr, msg.reply_to),
        )
        event = verdict.event
        # Mirror the scan: a hiring system's template is read exactly first.
        tmpl = read_template(msg.subject, msg.from_addr, msg.body)
        if tmpl is not None and tmpl.event == IGNORE:
            return Prediction(UNKNOWN, None, False)
        if tmpl is not None and tmpl.event:
            event = tmpl.event
        tm = (
            match_template(jobs, tmpl, msg.date, subject=msg.subject, text=msg.body)
            if tmpl is not None
            else None
        )
        match: JobMatch = tm or match_job(
            jobs,
            subject=msg.subject,
            from_addr=msg.from_addr,
            reply_to=msg.reply_to,
            text=msg.body,
            date=msg.date,
        )
        job = match.job
        if (
            tmpl is None
            and event != UNKNOWN
            and looks_like_digest(jobs, subject=msg.subject, text=msg.body)
        ):
            job = None  # a job alert / digest is never an update about one job
    except Exception as exc:  # noqa: BLE001 — a crash is a scored outcome
        return Prediction(ERROR, None, False, error=type(exc).__name__)
    job_id = job["id"] if job else None
    # No user board here: a move is proposed for any staged event that has a job
    # match and isn't a reminder (the stage-order guard needs real cards).
    surfaced = stage_for_event(event) is not None and bool(job) and not verdict.reminder
    return Prediction(
        event,
        job_id,
        surfaced,
        action=stage_for_event(event) if surfaced else None,
        body_blank=not (msg.body or "").strip(),
        read_issues=msg.read_issues,
        match_status=match.status,
        match_evidence=match.evidence,
    )


def predict_raw(
    uid: str, raw: bytes, jobs: list[dict], *, header_filter: bool = False
) -> Prediction:
    """Parse a raw RFC822 message the way the IMAP layer does, then predict.

    With ``header_filter`` it first applies the scan's header-only filter, as
    the sync does: a dropped email's body is never read or classified.
    """
    reason = ""
    if header_filter:
        companies = company_tokens([j["company"] for j in jobs])
        keep, reason = possible_job_email(parse_header_block(raw), companies)
        if not keep:
            return Prediction(UNKNOWN, None, False, filtered=True, filter_reason=reason)
    try:
        msg = _parse_message(uid, raw)
    except Exception as exc:  # noqa: BLE001 — a crash is a scored outcome
        return Prediction(ERROR, None, False, error=type(exc).__name__)
    p = predict_message(msg, jobs)
    p.filter_reason = reason
    return p


# --------------------------------------------------------------------------- #
# Human-readable excerpt (display only — the classifier still sees the raw body)
# --------------------------------------------------------------------------- #
_ZERO_WIDTH = re.compile("[​-‏⁠﻿­͏]")
_SPACE = re.compile(r"\s+")


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def excerpt(body: str, limit: int = 300) -> str:
    """A short, single-line, tag-free preview of an email body for labeling."""
    text = body or ""
    if "<" in text and ">" in text:
        parser = _TextOnly()
        try:
            parser.feed(text)
            text = " ".join(parser.parts)
        except Exception:  # noqa: BLE001 — fall back to the raw text
            pass
    text = _ZERO_WIDTH.sub("", html.unescape(text))
    text = _SPACE.sub(" ", text).strip()
    return text[:limit]
