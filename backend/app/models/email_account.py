"""EmailAccount ORM model — a user's connected inbox for auto-status.

Stores what we need to read a user's mailbox over IMAP so the app can detect
application updates (received / interview / rejection) and move Kanban cards for
them. The secret itself (an app-specific password today, an OAuth refresh token
later) is NEVER stored in plaintext: it's encrypted with Fernet
(``app.utils.crypto``) before it touches the database and decrypted only in
memory when we open the IMAP connection. One connected inbox per user.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# auth_type values
AUTH_APP_PASSWORD = "app_password"  # IMAP + an app-specific password
AUTH_OAUTH = "oauth"  # Gmail/Microsoft "sign in" token (added later)

# status values
STATUS_CONNECTED = "connected"
STATUS_ERROR = "error"


class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # One inbox per user (unique) — keeps the model simple; revisit if we ever
    # support connecting several mailboxes at once.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # The mailbox address we read (also shown back to the user as confirmation).
    email_address: Mapped[str] = mapped_column(String(255), nullable=False)
    # Friendly provider key we detected ("yahoo", "gmail", "icloud", "imap"…) —
    # drives which connection defaults + setup guide the UI shows.
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    auth_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AUTH_APP_PASSWORD
    )
    # IMAP endpoint. Filled from a provider preset for known hosts, or entered
    # by the user for a generic IMAP account.
    imap_host: Mapped[str] = mapped_column(String(255), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False, default=993)
    # Fernet token (base64 text) — the encrypted app-password. Never logged,
    # never returned by the API.
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATUS_CONNECTED
    )
    # Last error message (e.g. auth failed) so the UI can prompt a reconnect
    # without us logging the secret. NULL when healthy.
    last_error: Mapped[str | None] = mapped_column(Text)
    # Watermark so each scan only looks at mail newer than the last one.
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<EmailAccount user_id={self.user_id} provider={self.provider}>"
