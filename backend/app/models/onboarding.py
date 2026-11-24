"""Onboarding progress (spec 019 part B): one row per account.

Most Getting started ticks are worked out from real state (a résumé exists, a
Job Catcher said hello, …) in ``services/onboarding``; only what can't be
derived is stored here.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, SmallInteger, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class UserOnboarding(Base):
    __tablename__ = "user_onboarding"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # 0 not started · 1 résumé · 2 Job Catcher · 3 extras · 4 done
    welcome_step: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    # Finished or dismissed. Null: the Welcome opens on the next visit.
    welcome_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    checklist_hidden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # Set when the Claude connector is used (throttled to once an hour).
    claude_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
