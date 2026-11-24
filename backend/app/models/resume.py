"""Resume ORM model — the user's uploaded base resume.

Both the extracted text (used for AI generation) AND the original file bytes
are persisted. The bytes power ATS autofill: the extension rebuilds the real
PDF/DOCX in memory and attaches it to application upload fields. A resume is
~100KB — trivial in Postgres at this scale, and free-tier hosts have
ephemeral filesystems so the DB is the only durable place for it.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    # Original file bytes (nullable: resumes uploaded before this column
    # existed have text only — re-upload restores the file).
    file_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The résumé read once into {"work": [...], "education": [...]} for autofill
    # (spec 015; services/resume_history.py). Null until read.
    parsed_history: Mapped[dict | None] = mapped_column(JSON)
    parsed_history_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Background readings started (spec 020): counted BEFORE each reading, so a
    # résumé that crashes or hangs the reader is given up on after a few tries
    # instead of being picked again every hour.
    read_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="resumes")  # type: ignore[name-defined]
    generated_documents: Mapped[list["GeneratedDocument"]] = relationship(  # type: ignore[name-defined]
        "GeneratedDocument", back_populates="resume"
    )

    def __repr__(self) -> str:
        return (
            f"<Resume id={self.id} filename={self.filename!r} active={self.is_active}>"
        )
