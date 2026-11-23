"""TaughtField ORM model — a box the user pointed at and taught (spec 017).

When Job Catcher can't tell what a box on a site wants, the user points at it
in the side panel and chooses the answer ("Email", "First name", or typed
text). The box is remembered as a FINGERPRINT (its label, name, kind, place in
the form…), never as a CSS path, so it's found again when the site's markup
shifts. Per user and per site; served in the autofill bundle so it works on
every computer, included in the data export, deleted with the account.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class TaughtField(Base):
    __tablename__ = "taught_fields"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The site it was taught on: host, plus the company's path on shared hosts.
    site: Mapped[str] = mapped_column(String(255), nullable=False)
    # Label, name, id, autocomplete, kind, section, index… (≤ 4 KB, validated).
    fingerprint: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Exactly one of these: a profile answer's key, or a typed answer.
    profile_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
        return f"<TaughtField site={self.site!r} key={self.profile_key!r}>"
