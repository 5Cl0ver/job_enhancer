"""EmailFolderState ORM model — the per-folder sync cursor for a connected inbox.

IMAP UIDs ascend within a folder and are valid only for one UIDVALIDITY, so the
scanner keeps, per folder, the contiguous UID range it has fully processed:
``backfill_low``..``last_uid``. New mail is above ``last_uid``; the first-run
backfill walks down from the top until ``backfill_floor`` (the oldest UID inside
the backfill window). Anything not yet processed is simply outside the range,
so a capped or interrupted scan carries it over instead of skipping it.

Saved in the same transaction as the detected events, so a crash leaves both
unchanged. A UIDVALIDITY change resets the row.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

ROLE_INBOX = "inbox"
ROLE_JUNK = "junk"


class EmailFolderState(Base):
    __tablename__ = "email_folder_states"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    folder_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # inbox | junk
    uidvalidity: Mapped[int | None] = mapped_column(BigInteger)
    # Fully processed UID range [backfill_low, last_uid]; empty when low > last.
    last_uid: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    backfill_low: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    backfill_floor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # complete | carried_over | partial | interrupted
    last_status: Mapped[str | None] = mapped_column(String(20))
    last_report: Mapped[dict | None] = mapped_column(JSON)  # counts only
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "email_account_id", "folder_name", name="uq_email_folder_state"
        ),
    )

    def __repr__(self) -> str:
        return f"<EmailFolderState {self.role} last_uid={self.last_uid}>"
