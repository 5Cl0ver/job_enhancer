"""Resume ORM model — the user's uploaded base resume.

Only the extracted text is persisted (used for AI generation); the
original file bytes are not stored — free-tier hosts have ephemeral
filesystems, and re-uploading is cheap.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
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
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
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
