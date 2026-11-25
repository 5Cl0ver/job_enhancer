"""SkippedSite ORM model: a site the user never wants jobs from (spec 024).

Stored as a plain host ("learn4good.com": lowercase, no "www.", no path). A
site covers its sub-sites too (``services/skipped_sites.matches``). At most
100 per user, checked in the service.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class SkippedSite(Base):
    __tablename__ = "skipped_sites"
    __table_args__ = (
        UniqueConstraint("user_id", "host", name="uq_skipped_sites_user_host"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<SkippedSite host={self.host!r} user_id={self.user_id}>"
