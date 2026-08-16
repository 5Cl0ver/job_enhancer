"""DetectedEvent ORM model — one inbox-derived pipeline update, pending review.

Every time a scan reads an email and confidently classifies + matches it to a
saved job, it records a row here instead of moving the card immediately. That
gives us the two things the feature promised: a **review step** (the user
approves or dismisses each) and an **audit trail with undo** (``previous_stage_id``
remembers where the card was, so an applied move can always be reversed).

``(email_account_id, message_uid)`` is unique so re-scanning the same mailbox
never double-detects an email we've already seen.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
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
STATUS_AUTO_APPLIED = "auto_applied"  # moved automatically (scheduled mode, later)


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
    # The saved job this email is about (matcher's pick). CASCADE: if the job is
    # deleted, its detected events go too.
    saved_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("saved_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Classifier output: applied | interview | rejected | recruiter.
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Stage name we'd move the card to (NULL for a recruiter contact = no move).
    target_stage: Mapped[str | None] = mapped_column(String(50))

    # Enough of the email to show the user what we acted on (never the body).
    from_addr: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # IMAP UID — the dedupe key so a re-scan doesn't re-detect the same message.
    message_uid: Mapped[str] = mapped_column(String(255), nullable=False)

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
            "email_account_id", "message_uid", name="uq_detected_event_uid"
        ),
        Index("ix_detected_events_user_status", "user_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<DetectedEvent {self.event_type} job={self.saved_job_id} {self.status}>"
        )
