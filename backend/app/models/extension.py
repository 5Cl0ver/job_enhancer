"""Job Catcher on people's computers (spec 019).

- ``ExtensionToken``: the pass a Job Catcher gets when the user presses
  Connect and approves it in the app. Only its sha256 is stored; the raw
  ``jcx_…`` value lives in that Job Catcher alone. Revocable per computer.
- ``ExtensionConnectRequest``: one Connect attempt, short-lived and single-use.
  The panel that started it holds the poll token (hash stored here); the user
  approves it in the app by its code.
- ``ExtensionInstall``: a Job Catcher that said hello: its version and browser,
  for the "update available" note and the Getting started checklist.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class ExtensionToken(Base):
    __tablename__ = "extension_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    install_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    browser: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ExtensionConnectRequest(Base):
    __tablename__ = "extension_connect_requests"
    __table_args__ = (
        Index("ix_extension_connect_requests_created_at", "created_at"),
        Index("ix_extension_connect_requests_status_expires", "status", "expires_at"),
        Index("ix_extension_connect_requests_client", "client_hash", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(9), nullable=False, unique=True)
    poll_token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True
    )
    # sha256 of the starting Job Catcher's proof: approval must present it.
    proof_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # sha256 of the starter's rate-limit address (never the address itself):
    # caps how many may wait from one place.
    client_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    # pending → approved → used; or cancelled. Expiry is by time.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ExtensionInstall(Base):
    __tablename__ = "extension_installs"
    __table_args__ = (UniqueConstraint("user_id", "install_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    install_id: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    browser: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
