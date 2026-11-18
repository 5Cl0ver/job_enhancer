"""DetectedEvent ORM model — one inbox-derived pipeline update, pending review.

Every time a scan reads an email and confidently classifies + matches it to a
saved job, it records a row here instead of moving the card immediately. That
gives us the two things the feature promised: a **review step** (the user
approves or dismisses each) and an **audit trail with undo** (``previous_stage_id``
remembers where the card was, so an applied move can always be reversed).

Duplicates are blocked two ways. The physical key
``(email_account_id, folder, uidvalidity, message_uid)`` is unique: an IMAP UID
only identifies a message within one folder and one UIDVALIDITY. The logical key
``(email_account_id, logical_key)`` is unique too: it follows the *message*, so
mail that moves between inbox and spam (and gets a new UID) can't be detected
twice. Rows from before folders were tracked have ``uidvalidity`` NULL and are
adopted by the next scan that reaches them (see ``email_scan``).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# status lifecycle
STATUS_PENDING = "pending"  # detected, awaiting the user's review
STATUS_APPLIED = "applied"  # user approved → card was moved
STATUS_DISMISSED = "dismissed"  # user said "not this" → ignored
STATUS_AUTO_APPLIED = "auto_applied"  # moved by the scan itself (sure match)
# The scan couldn't tell which saved job (or what the email says): kept until
# the user picks the job / type or dismisses it. Never moves a card by itself.
STATUS_REVIEW = "needs_review"
# Low-value: unclear emails and confirmations we can't tie to one job. Kept
# (so they're never re-detected) but out of the way; never a question.
STATUS_HIDDEN = "hidden"
# An important update (interview, assessment, offer, rejection) about a job the
# user hasn't saved. Never moves a card; the user can add the job or dismiss it.
STATUS_UNSAVED = "unsaved"
# A recruiter reaching out. Kept, out of the way; never moves a card.
STATUS_CONTACT = "contact"
OPEN_STATUSES = (
    STATUS_PENDING,
    STATUS_REVIEW,
    STATUS_HIDDEN,
    STATUS_UNSAVED,
    STATUS_CONTACT,
)
APPROVED_STATUSES = (STATUS_APPLIED, STATUS_AUTO_APPLIED)


class DetectedEvent(Base):
    __tablename__ = "detected_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    email_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The saved job this email is about (matcher's pick). NULL only for a
    # needs_review item whose job the user hasn't chosen yet. CASCADE: if the job
    # is deleted, its detected events go too.
    saved_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("saved_jobs.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Classifier output: applied | interview | assessment | offer | rejected |
    # recruiter | unsure.
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Stage name we'd move the card to (NULL for a recruiter contact = no move).
    target_stage: Mapped[str | None] = mapped_column(String(50))

    # Enough of the email to show the user what we acted on (never the body).
    from_addr: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Where the email lives: folder + UIDVALIDITY + UID is the physical key.
    folder: Mapped[str] = mapped_column(
        String(255), nullable=False, default="INBOX", server_default="INBOX"
    )
    uidvalidity: Mapped[int | None] = mapped_column(BigInteger)
    message_uid: Mapped[str] = mapped_column(String(255), nullable=False)
    # Stable identity across folders: "emailid:<Yahoo EMAILID>", or
    # "mid:<hash of Message-ID + content>"; NULL when the email has no usable ID
    # (such emails never collapse together).
    logical_key: Mapped[str | None] = mapped_column(String(255))
    # Which evidence chose the job (job_url, known_sender, company_title, …), or
    # why it needs review (several_roles, title_only, unsure, no_match, …).
    match_evidence: Mapped[str | None] = mapped_column(String(40))
    # needs_review: the saved jobs it could be about (ids as strings).
    review_candidates: Mapped[list | None] = mapped_column(JSON)
    # unsaved / contact: the company and role, read from the email itself.
    job_company: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(255))

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATUS_PENDING
    )
    # Where the card was BEFORE we moved it — the undo target. NULL if it had no
    # stage yet.
    previous_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pipeline_stages.id", ondelete="SET NULL"),
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "email_account_id",
            "folder",
            "uidvalidity",
            "message_uid",
            name="uq_detected_event_location",
        ),
        UniqueConstraint(
            "email_account_id", "logical_key", name="uq_detected_event_logical"
        ),
        Index("ix_detected_events_user_status", "user_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<DetectedEvent {self.event_type} job={self.saved_job_id} {self.status}>"
        )
