"""ApplicationProfile ORM model — the user's "profile vault".

One row per user holding the answers every job application asks for (contact
info, links, work authorization, preferences). Filled once in Settings; the
extension's autofill consumes it to fill ATS forms (Greenhouse/Lever).

Everything is nullable by design — the user shares only what they want. The
row is included in the user's data export and dies with the account (FK
cascade), same self-managed model as the rest of their data.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class ApplicationProfile(Base):
    __tablename__ = "application_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Contact — ATS forms want first/last split (users.name is one string).
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str | None] = mapped_column(String(100))

    # Links
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    github_url: Mapped[str | None] = mapped_column(String(500))
    portfolio_url: Mapped[str | None] = mapped_column(String(500))

    # Work authorization — tri-state on purpose: True/False/unanswered.
    authorized_to_work: Mapped[bool | None] = mapped_column(Boolean)
    requires_sponsorship: Mapped[bool | None] = mapped_column(Boolean)
    willing_to_relocate: Mapped[bool | None] = mapped_column(Boolean)

    # Preferences
    desired_salary: Mapped[int | None] = mapped_column(Integer)  # yearly USD
    notice_period: Mapped[str | None] = mapped_column(String(100))  # "2 weeks"

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship("User", back_populates="application_profile")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<ApplicationProfile user_id={self.user_id}>"
