"""GeneratedDocument ORM model — AI-produced resume or cover letter.

PDFs are rendered on demand (weasyprint) rather than stored on disk.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class GeneratedDocument(Base):
    __tablename__ = "generated_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job_listings.id", ondelete="SET NULL"),
    )
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("resumes.id", ondelete="SET NULL"),
    )
    document_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'resume' | 'cover_letter'
    content: Mapped[str] = mapped_column(Text, nullable=False)
    edited_content: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str | None] = mapped_column(String(100))
    generation_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="generated_documents")  # type: ignore[name-defined]
    resume: Mapped["Resume | None"] = relationship(
        "Resume", back_populates="generated_documents"
    )  # type: ignore[name-defined]
    job_listing: Mapped["JobListing | None"] = relationship("JobListing")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<GeneratedDocument id={self.id} type={self.document_type}>"
