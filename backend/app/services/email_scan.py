"""Turn fetched emails into reviewable pipeline updates ("detected events").

The orchestration layer between the raw inbox (IMAP I/O lives elsewhere) and the
tracker. Kept free of I/O so it's fully unit-testable: hand it a list of
:class:`EmailMessage` and it classifies + matches each against the user's saved
jobs, recording a *pending* ``DetectedEvent`` for every confident hit. Nothing
is moved here — approving/undoing is a separate, user-driven step. Conservative
by design: unknown emails and low-confidence matches are dropped, never guessed.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import parseaddr
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import (
    APPROVED_STATUSES,
    STATUS_CONTACT,
    STATUS_HIDDEN,
    STATUS_PENDING,
    STATUS_REVIEW,
    STATUS_UNSAVED,
    DetectedEvent,
)
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services.email_classify import (
    ASSESSMENT,
    INTERVIEW,
    OFFER,
    RECRUITER,
    REJECTED,
    UNKNOWN,
    UNSURE,
    classify,
    stage_for_event,
)
from app.services.email_job_names import clean_role, is_sender_person, job_names
from app.services.email_match import (
    FUZZY_COMPANY,
    LIKELY_JOB,
    NONE,
    REVIEW,
    looks_like_digest,
    match_job,
    match_template,
    sender_is_saved_company,
)
from app.services.email_templates import IGNORE, read_template
from app.services.email_text import clean_header

logger = logging.getLogger("app.email_scan")

# How much of an email a scan reads. Job news sits at the top; a long newsletter
# read in full ties up the server's one worker until Render restarts it.
SCAN_TEXT_LIMIT = 30_000

# Updates worth the user's attention; only these can become a question.
IMPORTANT_EVENTS = (INTERVIEW, ASSESSMENT, OFFER, REJECTED)


@dataclass
class EmailMessage:
    """A fetched email, normalized to just what the classifier/matcher need."""

    uid: str
    from_addr: str
    subject: str
    body: str
    date: datetime | None = None
    message_id: str = ""  # RFC822 Message-ID header, for deep-linking (Gmail)
    # Newest reply only (quoted history removed); ``body`` is the full cleaned
    # text. Falls back to ``body`` when quote removal leaves almost nothing.
    newest_text: str = ""
    # How reading went — see app.services.email_text (blank, charset_fallback…)
    read_issues: tuple[str, ...] = ()
    # Where it lives: folder + UIDVALIDITY + UID is the physical key.
    folder: str = "INBOX"
    uidvalidity: int | None = None
    # Server-assigned stable id (IMAP OBJECTID / Yahoo EMAILID), "" if none.
    email_id: str = ""
    # Mailing-list headers present (List-Id / List-Unsubscribe / Precedence bulk)
    list_mail: bool = False
    reply_to: str = ""  # Reply-To header (decoded), a matching signal

    @property
    def classify_text(self) -> str:
        """What the classifier reads: the newest reply, else the full text."""
        return self.newest_text or self.body


@dataclass
class Considered:
    """A near-miss the scan looked at but did NOT surface — for transparency.

    Either a card-moving signal we couldn't confidently match to a saved job, or
    a matched recruiter contact we deliberately don't surface. Spam (UNKNOWN with
    no match) is excluded — it's noise, not a decision worth showing.
    """

    from_addr: str
    subject: str
    event_type: str
    # no_confident_match | filtered_contact | unsure | reminder |
    # already_at_or_past_stage | needs_review (unclear which saved job)
    reason: str
    matched_company: str | None = None
    matched_title: str | None = None
    matched_job_listing_id: uuid.UUID | None = None  # link target in the app
    mail_link: str | None = None
    date: datetime | None = None
    # How the job was (or couldn't be) chosen — see app.services.email_match.
    match_evidence: str | None = None
    # needs_review: the saved jobs it could be about, for the user to pick.
    candidates: list[dict] = field(default_factory=list)


@dataclass
class DetectResult:
    """Outcome of a scan: surfaced updates plus the near-misses we skipped."""

    created: list[DetectedEvent] = field(default_factory=list)
    # Stored questions: an important update whose saved job is unclear. Kept
    # (uncapped) until the user picks the job or dismisses it.
    review: list[DetectedEvent] = field(default_factory=list)
    # Stored but hidden by default: unclear emails, confirmations with an
    # unclear job. Never a question.
    hidden: list[DetectedEvent] = field(default_factory=list)
    # Important updates about a job the user hasn't saved (never move a card).
    unsaved: list[DetectedEvent] = field(default_factory=list)
    # Recruiters reaching out (kept, out of the way).
    contacts: list[DetectedEvent] = field(default_factory=list)
    # What was skipped without storing, by reason (job_alert, contact, …).
    skipped: dict[str, int] = field(default_factory=dict)
    considered: list[Considered] = field(default_factory=list)
    scanned: int = 0  # total messages read this scan
    candidates: int = 0  # saved jobs we matched against


# Cap the transparency list so a huge inbox can't return an unbounded payload.
# Only the informational near-misses are capped; items needing the user's
# choice are stored rows (``DetectResult.review``) and never dropped.
_MAX_CONSIDERED = 40


# Yahoo and AOL run the same web mail. Its address for one message is the
# folder's MAILBOXID and the message's EMAILID, the ids their IMAP server gives
# out (RFC 8474 OBJECTID). The inbox is always mailbox 1.
_YAHOO_HOSTS = {"yahoo": "mail.yahoo.com", "aol": "mail.aol.com"}
_EARLIEST_EMAIL = datetime(2000, 1, 1, tzinfo=UTC)
_INBOX_MAILBOX_ID = "1"
_EMAILID_PREFIX = "emailid:"


def sent_at(date: datetime | None, now: datetime | None = None) -> datetime | None:
    """An email's Date header as a time worth storing: in UTC, and believable.
    A header with no time zone is read as UTC. A date before 2000 or after
    tomorrow is forged or broken (and can overflow the database), so it is
    dropped; the page then says when the email was found instead."""
    if date is None:
        return None
    try:
        utc = (date if date.tzinfo else date.replace(tzinfo=UTC)).astimezone(UTC)
    except (OverflowError, ValueError):
        return None
    latest = (now or datetime.now(tz=UTC)) + timedelta(days=1)
    return utc if _EARLIEST_EMAIL <= utc <= latest else None


def email_id_of(logical: str | None) -> str:
    """The server's own id for an email, from a stored ``logical_key``
    ("emailid:…"); "" when the key was built another way."""
    if logical and logical.startswith(_EMAILID_PREFIX):
        return logical[len(_EMAILID_PREFIX) :]
    return ""


def mail_search_link(
    provider: str, subject: str = "", from_addr: str = ""
) -> str | None:
    """A webmail search that should land on this email: its subject plus, where
    it helps, its sender (many job emails share a subject). None for a provider
    with no usable search address."""
    subj = (subject or "").strip()
    sender = parseaddr(from_addr or "")[1]
    if provider == "gmail":
        terms = " ".join(t for t in (f"from:{sender}" if sender else "", subj) if t)
        return (
            f"https://mail.google.com/mail/u/0/#search/{quote(terms)}"
            if terms
            else None
        )
    if provider in _YAHOO_HOSTS:
        terms = " ".join(t for t in (subj, sender) if t)
        if terms:
            return f"https://{_YAHOO_HOSTS[provider]}/d/search/keyword={quote(terms)}"
    return None


def mail_link(
    provider: str,
    message_id: str = "",
    subject: str = "",
    *,
    email_id: str = "",
    folder: str = "",
    from_addr: str = "",
) -> str | None:
    """A link that takes the user to this email in their webmail.

    The exact message when we can name it: Gmail by its RFC822 Message-ID,
    Yahoo/AOL by the server's EMAILID for mail in the inbox. Otherwise a search
    (``mail_search_link``). Providers with neither return None and the UI just
    shows sender/subject/date.
    """
    mid = (message_id or "").strip().strip("<>")
    if provider == "gmail" and mid:
        return f"https://mail.google.com/mail/u/0/#search/rfc822msgid:{quote(mid)}"
    if provider in _YAHOO_HOSTS and email_id and folder.upper() == "INBOX":
        host = _YAHOO_HOSTS[provider]
        message = quote(email_id, safe="")
        return f"https://{host}/d/folders/{_INBOX_MAILBOX_ID}/messages/{message}"
    return mail_search_link(provider, subject, from_addr)


async def _candidate_jobs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's active saved jobs as match candidates (id + stage + names)."""
    rows = (
        await db.execute(
            select(
                SavedJob.id,
                SavedJob.job_listing_id,
                SavedJob.pipeline_stage_id,
                SavedJob.created_at,
                func.coalesce(SavedJob.custom_company, JobListing.company).label(
                    "company"
                ),
                func.coalesce(SavedJob.custom_title, JobListing.title).label("title"),
                JobListing.apply_url,
                JobListing.external_id,
            )
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .where(
                SavedJob.user_id == user_id,
                SavedJob.is_archived.is_(False),
            )
        )
    ).all()
    return [
        {
            "id": r.id,
            "job_listing_id": r.job_listing_id,
            "pipeline_stage_id": r.pipeline_stage_id,
            "company": r.company,
            "title": r.title,
            "apply_url": r.apply_url,
            "external_id": r.external_id,
            "saved_at": r.created_at,
        }
        for r in rows
    ]


_SEP = chr(0)  # field separator for hashing


def logical_key(msg: EmailMessage) -> str | None:
    """A message's identity across folders, or None when it has no usable ID.

    The server's EMAILID (IMAP OBJECTID) is stable when mail moves between
    inbox and spam. Without it, the Message-ID is combined with a hash of the
    content (sender, subject, date, body), so a reused or forged Message-ID on a
    *different* email gets a different key and can't suppress it. An email with
    neither ID gets no key, so ID-less emails never collapse together.
    """
    if msg.email_id:
        return f"emailid:{msg.email_id}"[:255]
    mid = (msg.message_id or "").strip().strip("<>").lower()
    if not mid:
        return None
    content = _SEP.join(
        [
            parseaddr(msg.from_addr or "")[1].lower(),
            clean_header(msg.subject or ""),
            msg.date.isoformat() if msg.date else "",
            msg.body or "",
        ]
    )
    digest = hashlib.sha256((mid + _SEP + content).encode()).hexdigest()
    return f"mid:{digest}"


class _Seen:
    """What this account has already detected, for duplicate checks."""

    def __init__(self, rows: list[DetectedEvent]) -> None:
        # Includes NULL-UIDVALIDITY rows: the database's unique key treats NULLs
        # as distinct, so this check is what stops a repeat for such messages.
        self.locations = {(r.folder, r.uidvalidity, r.message_uid) for r in rows}
        self.keys = {r.logical_key for r in rows if r.logical_key}
        # Address -> saved jobs it sent updates about that the USER approved (a
        # matching signal; the matcher ignores relay and no-reply addresses).
        # Pending guesses don't count: a wrong one would teach a wrong sender.
        # Nor do the app's own placements by company (likely_job), even moved:
        # only the user's approval or a sure match teaches a sender.
        self.senders: dict[str, set] = {}
        for r in rows:
            if (
                r.status in APPROVED_STATUSES
                and r.saved_job_id
                and r.from_addr
                and r.match_evidence != LIKELY_JOB
            ):
                addr = parseaddr(r.from_addr)[1].lower()
                if addr:
                    self.senders.setdefault(addr, set()).add(r.saved_job_id)
        # Pre-folder rows: inbox, UIDVALIDITY unknown, keyed by UID.
        self.legacy = {
            r.message_uid: r
            for r in rows
            if r.uidvalidity is None and r.folder == "INBOX"
        }

    @classmethod
    async def load(cls, db: AsyncSession, account_id: uuid.UUID) -> _Seen:
        rows = list(
            await db.scalars(
                select(DetectedEvent).where(
                    DetectedEvent.email_account_id == account_id
                )
            )
        )
        return cls(rows)

    def has(self, msg: EmailMessage, key: str | None) -> bool:
        if (msg.folder, msg.uidvalidity, msg.uid) in self.locations:
            return True
        return bool(key) and key in self.keys

    def add(self, msg: EmailMessage, key: str | None) -> None:
        self.locations.add((msg.folder, msg.uidvalidity, msg.uid))
        if key:
            self.keys.add(key)

    def adopt_legacy(self, msg: EmailMessage, key: str | None) -> bool:
        """A pre-folder row for this inbox UID, with the same subject and sender,
        IS this email: fill in its location and identity instead of detecting it
        again. A different subject means the UID now names another email."""
        row = self.legacy.get(msg.uid)
        if row is None or msg.folder != "INBOX" or msg.uidvalidity is None:
            return False
        same = (
            clean_header(row.subject) == clean_header(msg.subject)[:500]
            and (row.from_addr or "") == (msg.from_addr or "")[:255]
        )
        if not same:
            return False
        row.uidvalidity = msg.uidvalidity
        if key and key not in self.keys:
            row.logical_key = key
        del self.legacy[msg.uid]
        self.add(msg, key)
        return True


async def _stage_orders(
    db: AsyncSession, user_id: uuid.UUID
) -> tuple[dict[str, int], dict[uuid.UUID, int]]:
    """The user's stages: name → sort order, and id → sort order."""
    rows = (
        await db.execute(
            select(
                PipelineStage.id, PipelineStage.name, PipelineStage.sort_order
            ).where(PipelineStage.user_id == user_id)
        )
    ).all()
    return {r.name: r.sort_order for r in rows}, {r.id: r.sort_order for r in rows}


def card_action(
    target_stage: str | None,
    stage_orders: dict[str, int],
    *,
    current_order: int | None,
    reminder: bool,
) -> tuple[bool, str]:
    """Should this email propose a card move? ``(propose, reason)``.

    Email type and card action are separate: a reminder never moves a card,
    and a move only goes *forward* in the user's own stage order — an old
    confirmation or a late interview email can't drag a card backward. A
    target stage the user has deleted is still proposed, flagged
    ``stage_missing`` so the review can say so instead of reporting a move.
    """
    if target_stage is None:
        return False, ""
    if reminder:
        return False, "reminder"
    target_order = stage_orders.get(target_stage)
    if target_order is None:
        return True, "stage_missing"
    if current_order is not None and target_order <= current_order:
        return False, "already_at_or_past_stage"
    return True, "forward"


def _read(msg: EmailMessage, jobs: list[dict]):
    """The CPU-heavy reading of one email: its hiring-system template, if any,
    and the classifier's verdict (None when the template says to ignore it)."""
    # A hiring system's own template (Indeed, LinkedIn, Workday, …) is
    # read exactly: it names the company and job, and often the outcome.
    tmpl = read_template(msg.subject, msg.from_addr, msg.body)
    if tmpl is not None and tmpl.event == IGNORE:
        return tmpl, None
    verdict = classify(
        msg.subject,
        msg.classify_text,
        msg.from_addr,
        bulk=msg.list_mail,
        job_sender=sender_is_saved_company(jobs, msg.from_addr, msg.reply_to),
    )
    return tmpl, verdict


async def detect_events(
    db: AsyncSession,
    account: EmailAccount,
    messages: list[EmailMessage],
) -> DetectResult:
    """Classify + match each message; record new pending DetectedEvents.

    Returns a :class:`DetectResult` with the surfaced ``created`` events plus the
    ``considered`` near-misses (for the "what else I looked at" transparency
    view). Messages already detected — by location or by identity (see
    :func:`logical_key`) — and pure spam (``UNKNOWN`` with no match) are skipped
    silently. Rows from before folders were tracked are adopted, not repeated.
    """
    seen = await _Seen.load(db, account.id)
    jobs = await _candidate_jobs(db, account.user_id)
    stage_orders, order_of_id = await _stage_orders(db, account.user_id)
    result = DetectResult(scanned=len(messages), candidates=len(jobs))
    own_address = (account.email_address or "").lower()

    for msg in messages:
        if not msg.uid:
            continue
        key = logical_key(msg)
        if seen.has(msg, key) or seen.adopt_legacy(msg, key):
            continue
        if own_address and parseaddr(msg.from_addr or "")[1].lower() == own_address:
            # Mail you sent yourself (a forward, a note) repeats an email that
            # is already in the inbox — never a new update.
            seen.add(msg, key)
            result.skipped["own_mail"] = result.skipped.get("own_mail", 0) + 1
            continue
        msg.body = msg.body[:SCAN_TEXT_LIMIT]
        msg.newest_text = msg.newest_text[:SCAN_TEXT_LIMIT]
        # Off the event loop, so the app keeps answering while a scan reads.
        tmpl, verdict = await asyncio.to_thread(_read, msg, jobs)
        if verdict is None:
            seen.add(msg, key)
            result.skipped["job_alert"] = result.skipped.get("job_alert", 0) + 1
            continue
        event_type = verdict.event
        if tmpl is not None and tmpl.event:
            event_type = tmpl.event  # the template states the outcome
        if event_type == UNKNOWN:
            continue  # spam / no job signal — pure noise, not worth reporting
        seen.add(msg, key)
        if tmpl is None and looks_like_digest(jobs, subject=msg.subject, text=msg.body):
            # Names several saved jobs across companies: a job alert / digest.
            result.skipped["job_alert"] = result.skipped.get("job_alert", 0) + 1
            continue

        # Matching reads the FULL cleaned text (signatures, quoted job details),
        # plus the display name, sender/Reply-To domains and known senders.
        match = match_template(jobs, tmpl, msg.date) if tmpl is not None else None
        if match is None:
            match = match_job(
                jobs,
                subject=msg.subject,
                from_addr=msg.from_addr,
                reply_to=msg.reply_to,
                text=msg.body,
                date=msg.date,
                known_senders=seen.senders,
            )
        job = match.job  # only set for a clear match
        target_stage = stage_for_event(event_type)
        propose, why = card_action(
            target_stage,
            stage_orders,
            current_order=order_of_id.get(job.get("pipeline_stage_id"))
            if job
            else None,
            reminder=verdict.reminder,
        )

        # What every stored row records about the email and how it was matched.
        common = {
            "user_id": account.user_id,
            "email_account_id": account.id,
            "from_addr": (msg.from_addr or "")[:255],
            "subject": (msg.subject or "")[:500],
            "folder": msg.folder,
            "uidvalidity": msg.uidvalidity,
            "message_uid": msg.uid,
            "logical_key": key,
            "match_evidence": match.evidence or None,
            "email_date": sent_at(msg.date),
        }

        # A forward card move WITH a confident match becomes a pending update.
        # Only an IMPORTANT update (interview, assessment, offer, rejection)
        # whose job is unclear becomes a question. Unclear emails and
        # confirmations we can't tie to one job are stored hidden. Everything
        # else with a job signal is an informational near-miss, never acted on.
        # A near-miss company spelling alone is too weak to ask about: such
        # matches mostly come from look-alike words in another sender's text.
        needs_choice = (
            event_type in IMPORTANT_EVENTS
            and match.status == REVIEW
            and match.evidence != FUZZY_COMPANY
            and target_stage is not None
            and not verdict.reminder
        )
        # An important update that isn't about a saved job: no match at all, or
        # only a look-alike company spelling (on real mail, almost always another
        # company's email). Kept so it isn't lost; it never moves a card.
        unsaved = (
            event_type in IMPORTANT_EVENTS
            and target_stage is not None
            and not verdict.reminder
            and (
                match.status == NONE
                or (match.status == REVIEW and match.evidence == FUZZY_COMPANY)
            )
        )
        low_value = event_type == UNSURE or (
            match.status == REVIEW and target_stage is not None and not verdict.reminder
        )
        contact = event_type == RECRUITER
        names = {}
        if unsaved or contact:
            company, title = job_names(msg.subject, msg.from_addr, msg.classify_text)
            # Never the sender for the company (a template's company is exact).
            if is_sender_person(company, msg.from_addr):
                company = None
            if tmpl is not None:  # the template's names are exact
                company, title = tmpl.company or company, tmpl.title or title
            # Never a sentence for a title; a template's own title only loses a
            # lead-in.
            if title:
                title = clean_role(title, strict=tmpl is None or not tmpl.title)
            names = {
                "job_company": job["company"] if job else company,
                "job_title": job["title"] if job else title,
            }
        if propose and job:
            result.created.append(
                DetectedEvent(
                    id=uuid.uuid4(),
                    **common,
                    saved_job_id=job["id"],
                    event_type=event_type,
                    target_stage=target_stage,
                    previous_stage_id=job.get("pipeline_stage_id"),
                    status=STATUS_PENDING,
                )
            )
        elif needs_choice:
            options = match.candidates or ([job] if job else [])
            result.review.append(
                DetectedEvent(
                    id=uuid.uuid4(),
                    **common,
                    saved_job_id=None,
                    event_type=event_type,
                    target_stage=target_stage,
                    status=STATUS_REVIEW,
                    review_candidates=[str(c["id"]) for c in options],
                )
            )
        elif unsaved:
            result.unsaved.append(
                DetectedEvent(
                    id=uuid.uuid4(),
                    **common,
                    **names,
                    saved_job_id=None,
                    event_type=event_type,
                    target_stage=target_stage,
                    status=STATUS_UNSAVED,
                )
            )
        elif low_value:
            result.hidden.append(
                DetectedEvent(
                    id=uuid.uuid4(),
                    **common,
                    saved_job_id=job["id"] if job else None,
                    event_type=event_type,
                    target_stage=target_stage,
                    status=STATUS_HIDDEN,
                    review_candidates=[str(c["id"]) for c in match.candidates],
                )
            )
        elif contact:
            result.contacts.append(
                DetectedEvent(
                    id=uuid.uuid4(),
                    **common,
                    **names,
                    saved_job_id=job["id"] if job else None,
                    event_type=event_type,
                    target_stage=None,
                    status=STATUS_CONTACT,
                )
            )
        else:
            why_key = "no_saved_job"
            if why in ("reminder", "already_at_or_past_stage"):
                why_key = why
            result.skipped[why_key] = result.skipped.get(why_key, 0) + 1
        stored = (propose and job) or needs_choice or unsaved or low_value or contact
        if not stored and len(result.considered) < _MAX_CONSIDERED:
            # Why it wasn't surfaced: a reminder, a move that would go backward,
            # a contact, or no confident job match.
            if match.status == REVIEW:
                reason = "needs_review"  # a contact/reminder with an unclear job
            elif why in ("reminder", "already_at_or_past_stage"):
                reason = why
            else:
                reason = "filtered_contact" if job else "no_confident_match"
            result.considered.append(
                Considered(
                    from_addr=(msg.from_addr or "")[:255],
                    subject=(msg.subject or "")[:500],
                    event_type=event_type,
                    reason=reason,
                    matched_company=job["company"] if job else None,
                    matched_title=job["title"] if job else None,
                    matched_job_listing_id=job["job_listing_id"] if job else None,
                    mail_link=mail_link(account.provider, msg.message_id, msg.subject),
                    date=msg.date,
                    match_evidence=match.evidence or None,
                    candidates=[
                        {
                            "company": c["company"],
                            "title": c["title"],
                            "job_listing_id": c["job_listing_id"],
                        }
                        for c in match.candidates[:5]
                    ],
                )
            )

    db.add_all(
        [
            *result.created,
            *result.review,
            *result.hidden,
            *result.unsaved,
            *result.contacts,
        ]
    )
    await db.flush()
    logger.info(
        "email scan: %d messages, %d candidate jobs → %d new, %d to review, "
        "%d hidden, %d considered",
        len(messages),
        len(jobs),
        len(result.created),
        len(result.review),
        len(result.hidden),
        len(result.considered),
    )
    for ev in result.created:
        logger.info(
            "  detected %s → %s (job=%s) subj=%r",
            ev.event_type,
            ev.target_stage,
            ev.saved_job_id,
            ev.subject[:60],
        )
    return result
