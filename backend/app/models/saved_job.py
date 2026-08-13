"""SavedJob ORM model — user's saved job with tracking state."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class SavedJob(Base):
    __tablename__ = "saved_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job_listings.id"),
        nullable=False,
    )
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.id", ondelete="SET NULL"),
    )
    pipeline_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pipeline_stages.id", ondelete="SET NULL"),
    )
    notes: Mapped[str | None] = mapped_column(Text)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_stage_change: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        # Client-side default too (not just server_default): the live Postgres
        # column was created without a DB default, so relying on the server to
        # fill it inserted NULL and violated NOT NULL. Sending the value from
        # the ORM makes saves work regardless of DB-schema drift.
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    follow_up_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "Contact Further" research shortlist — a flag that lives ALONGSIDE the
    # pipeline stage (a job can be Applied AND flagged for company research).
    flagged_for_research: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # When the user sent an outreach email for this job (NULL = not emailed yet).
    # Doubles as both the "have I contacted them?" flag and the date shown in the UI.
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="saved_jobs")  # type: ignore[name-defined]
    job_listing: Mapped["JobListing"] = relationship(
        "JobListing", back_populates="saved_by"
    )  # type: ignore[name-defined]
    collection: Mapped["Collection | None"] = relationship(
        "Collection", back_populates="saved_jobs"
    )  # type: ignore[name-defined]
    pipeline_stage: Mapped["PipelineStage | None"] = relationship(
        "PipelineStage", back_populates="saved_jobs"
    )  # type: ignore[name-defined]
    from sqlalchemy import Index

    __table_args__ = (
        UniqueConstraint("user_id", "job_listing_id", name="uq_saved_job_user_listing"),
        Index("ix_saved_jobs_user_stage", "user_id", "pipeline_stage_id"),
        Index("ix_saved_jobs_user_collection", "user_id", "collection_id"),
        Index("ix_saved_jobs_last_stage_change", "last_stage_change"),
    )

    def __repr__(self) -> str:
        return f"<SavedJob id={self.id} listing={self.job_listing_id}>"
