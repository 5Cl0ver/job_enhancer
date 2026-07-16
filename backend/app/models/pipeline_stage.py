"""PipelineStage ORM model — per-user Kanban stages."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base

# Default stages seeded for every new user (in display order)
DEFAULT_STAGES: list[dict] = [
    {"name": "Interested", "sort_order": 1},
    {"name": "Referral Sent", "sort_order": 2},
    {"name": "Applied", "sort_order": 3},
    {"name": "Phone Screen", "sort_order": 4},
    {"name": "Take-Home Assignment", "sort_order": 5},
    {"name": "Interview", "sort_order": 6},
    {"name": "Offer", "sort_order": 7},
    {"name": "Rejected", "sort_order": 8},
]


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="pipeline_stages")  # type: ignore[name-defined]
    saved_jobs: Mapped[list["SavedJob"]] = relationship(  # type: ignore[name-defined]
        "SavedJob", back_populates="pipeline_stage"
    )

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_stage_user_name"),)

    def __repr__(self) -> str:
        return (
            f"<PipelineStage id={self.id} name={self.name!r} order={self.sort_order}>"
        )
