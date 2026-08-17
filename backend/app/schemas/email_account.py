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
    created_at: datetime

    model_config = {"from_attributes": True}


class DetectedEventOut(BaseModel):
    """A pending (or reviewed) inbox-derived pipeline update."""

    id: uuid.UUID
    saved_job_id: uuid.UUID
    event_type: str
    target_stage: str | None = None
    from_addr: str
    subject: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ConsideredOut(BaseModel):
    """A near-miss the scan looked at but did not surface (transparency view)."""

    from_addr: str
    subject: str
    event_type: str
    reason: str  # "no_confident_match" | "filtered_contact"
    matched_company: str | None = None
    matched_title: str | None = None
    mail_link: str | None = None
    date: datetime | None = None

    model_config = {"from_attributes": True}


class ScanResult(BaseModel):
    """Outcome of a scan: new updates plus the near-misses we didn't surface."""

    detected: int
    events: list[DetectedEventOut]
    considered: list[ConsideredOut] = []
