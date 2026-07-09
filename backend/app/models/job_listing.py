"""JobListing ORM model — shared across all users, deduplicated at insert."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class JobListing(Base):
    __tablename__ = "job_listings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    external_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # adzuna | jsearch
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    is_remote: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str | None] = mapped_column(String(10), default="USD")
    job_type: Mapped[str | None] = mapped_column(String(50))
    apply_url: Mapped[str] = mapped_column(Text, nullable=False)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_expired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Deduplication fields
    content_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    company_normalized: Mapped[str] = mapped_column(String(255), nullable=False)
    title_normalized: Mapped[str] = mapped_column(String(500), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    refreshed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    saved_by: Mapped[list["SavedJob"]] = relationship(  # type: ignore[name-defined]
        "SavedJob", back_populates="job_listing"
    )

    __table_args__ = (
        Index("ix_job_listings_dedup", "company_normalized", "title_normalized"),
        Index("ix_job_listings_posted_at", "posted_at"),
        Index("ix_job_listings_is_expired", "is_expired"),
    )

    def __repr__(self) -> str:
        return f"<JobListing id={self.id} title={self.title!r} company={self.company!r}>"
