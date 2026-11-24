"""Fair use of the shared free services (spec 019 part C, research R9).

- ``UsageCounter``: how many of one kind a person used in one period (a
  US-Pacific day, ``2026-11-24``), or the shared monthly JSearch count
  (``user_id`` NULL, period ``2026-11``).
- ``AppSetting``: owner-editable settings, e.g. the ``allowances`` numbers.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (
        # NULLS NOT DISTINCT (Postgres 15+): the one shared row stays one row.
        UniqueConstraint(
            "user_id",
            "kind",
            "period",
            name="uq_usage_counters_user_kind_period",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    period: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
