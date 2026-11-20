"""Pydantic schemas for the email auto-status feature.

Request/response shapes for connecting an inbox and reviewing detected updates.
The stored secret (app-password) is write-only: it comes IN on connect and is
never part of any response model.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class ProviderInfoOut(BaseModel):
    """How to connect a given email address — drives the Settings UI."""

    provider: str
    label: str
    connect_method: str  # app_password | oauth | forward
    imap_host: str
    imap_port: int
    guide: str


class EmailConnectRequest(BaseModel):
    """Connect (or reconnect) a mailbox with an app-password over IMAP."""

    email_address: EmailStr
    app_password: str = Field(min_length=1, max_length=255)
    # Optional overrides for a generic/unknown IMAP host. When omitted we use the
    # detected provider preset.
    imap_host: str | None = Field(default=None, max_length=255)
    imap_port: int | None = Field(default=None, ge=1, le=65535)


class EmailAccountOut(BaseModel):
    """A connected mailbox — never includes the secret."""

    id: uuid.UUID
    email_address: str
    provider: str
    auth_type: str
    imap_host: str
    imap_port: int
    status: str
    last_error: str | None = None
    last_scan_at: datetime | None = None
    auto_move: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailSettingsRequest(BaseModel):
    """Email Updates settings the user can change."""

    auto_move: bool


class DetectedEventOut(BaseModel):
    """A pending (or reviewed) inbox-derived pipeline update."""

    id: uuid.UUID
    # None only for a needs_review item whose job the user hasn't chosen yet.
    saved_job_id: uuid.UUID | None = None
    job_listing_id: uuid.UUID | None = None  # link target: /jobs/:id in the app
    event_type: str
    target_stage: str | None = None
    from_addr: str
    subject: str
    status: str
    # The email in the user's webmail: the exact message when it can be named,
    # else a search for it.
    mail_link: str | None = None
    # Always a search, for when the exact link doesn't open the message.
    mail_search_link: str | None = None
    # The target stage was deleted: approving can't move the card.
    stage_missing: bool = False
    # How the job was chosen (job_url, job_id, known_sender, company_title,
    # company_date), or why it needs review (several_roles, title_only, …).
    # Stored with the event, so it survives the scan.
    match_evidence: str | None = None
    # needs_review only: why ("unsure" = unclear what the email says; else the
    # matcher's reason) and the saved jobs it could be about.
    review_reason: str | None = None
    candidates: list["MatchCandidateOut"] = []
    folder: str | None = None  # inbox / spam folder it was found in
    # How the Email Updates page groups it: important | confirmation |
    # question | unsaved (important, job not saved) | contact | hidden.
    category: str = "important"
    # The chosen job's names, for a plain sentence ("Acme rejected your …").
    company: str | None = None
    title: str | None = None
    # Where the saved job's card is now ("Interested"), so the page can say
    # what a click would change. None for unsaved jobs or a card with no stage.
    current_stage: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MatchCandidateOut(BaseModel):
    """A saved job a needs-review email could be about."""

    company: str
    title: str
    job_listing_id: uuid.UUID | None = None
    saved_job_id: uuid.UUID | None = None  # what a one-click resolve sends


class JobEmailLatestOut(BaseModel):
    """The email that best explains where a saved job's card sits: the newest
    one that moved it, else the newest one about it."""

    saved_job_id: uuid.UUID
    event_id: uuid.UUID
    event_type: str
    status: str
    target_stage: str | None = None
    created_at: datetime
    # How many emails are tied to the job (not counting dismissed ones).
    count: int


class EmailMessageOut(BaseModel):
    """One detected email, fetched read-only on demand — plain text only."""

    subject: str
    from_addr: str
    date: datetime | None = None
    text: str
    mail_link: str | None = None  # the exact message when possible, else a search
    mail_search_link: str | None = None  # always a search


class TrackEventRequest(BaseModel):
    """Add the job an unsaved update is about to the user's tracker."""

    company: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=500)


class ResolveEventRequest(BaseModel):
    """The user's answer to a needs-review item."""

    saved_job_id: uuid.UUID
    # Required for an unsure email: what it actually says.
    event_type: str | None = Field(
        default=None, pattern="^(applied|interview|assessment|offer|rejected)$"
    )


class ConsideredOut(BaseModel):
    """A near-miss the scan looked at but did not surface (transparency view)."""

    from_addr: str
    subject: str
    event_type: str
    # no_confident_match | filtered_contact | reminder |
    # already_at_or_past_stage | needs_review (a contact with an unclear job).
    # Unsure emails and unclear card moves are stored review items instead.
    reason: str
    matched_company: str | None = None
    matched_title: str | None = None
    matched_job_listing_id: uuid.UUID | None = None
    mail_link: str | None = None
    date: datetime | None = None
    match_evidence: str | None = None
    candidates: list[MatchCandidateOut] = []

    model_config = {"from_attributes": True}


class FolderSyncOut(BaseModel):
    """Per-folder sync counts (no folder names, no email content)."""

    role: str  # inbox | junk
    status: str  # complete | carried_over | partial | interrupted
    stopped_by: str = ""  # body_cap | time_budget | fetch_incomplete
    visible: int = 0
    new: int = 0
    headers_read: int = 0
    filtered_out: int = 0
    kept: int = 0
    already_known: int = 0
    bodies_fetched: int = 0
    oversize: int = 0
    out_of_window: int = 0
    vanished: int = 0
    rechecked: int = 0
    carried_over: int = 0
    partial: list[str] = []
    view_limited: bool = False
    uidvalidity_changed: bool = False


class ScanResult(BaseModel):
    """Outcome of a scan: new updates plus the near-misses we didn't surface."""

    detected: int
    events: list[DetectedEventOut]
    # New questions this scan stored (they also appear in /events).
    review: list[DetectedEventOut] = []
    # New low-value items stored hidden, and what was skipped unstored (job
    # alerts, contacts, reminders…) — counts only.
    hidden: int = 0
    moved: int = 0  # cards the scan moved by itself (sure matches)
    unsaved: int = 0  # important updates about jobs not saved
    contacts: int = 0  # recruiter messages
    skipped: dict[str, int] = {}
    considered: list[ConsideredOut] = []
    scanned: int = 0  # total emails read this scan
    candidates: int = 0  # saved jobs matched against
    window_days: int = 0  # how far back we looked
    # Sync details (Phase 3): per-folder counts, what carries over to the next
    # scan, and why a scan stopped early (rate_limited, connection_lost, …).
    folders: list[FolderSyncOut] = []
    carried_over: int = 0
    interrupted: str | None = None
