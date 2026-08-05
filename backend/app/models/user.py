"""User ORM model."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    image: Mapped[str | None] = mapped_column(String(2048))
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    email_verified: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    follow_up_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    collections: Mapped[list["Collection"]] = relationship(  # type: ignore[name-defined]
        "Collection", back_populates="user", cascade="all, delete-orphan"
    )
    saved_jobs: Mapped[list["SavedJob"]] = relationship(  # type: ignore[name-defined]
        "SavedJob", back_populates="user", cascade="all, delete-orphan"
    )
    pipeline_stages: Mapped[list["PipelineStage"]] = relationship(  # type: ignore[name-defined]
        "PipelineStage", back_populates="user", cascade="all, delete-orphan"
    )
    resumes: Mapped[list["Resume"]] = relationship(  # type: ignore[name-defined]
        "Resume", back_populates="user", cascade="all, delete-orphan"
    )
    generated_documents: Mapped[list["GeneratedDocument"]] = relationship(  # type: ignore[name-defined]
        "GeneratedDocument", back_populates="user", cascade="all, delete-orphan"
    )
    application_profile: Mapped["ApplicationProfile | None"] = relationship(  # type: ignore[name-defined]
        "ApplicationProfile", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email} role={self.role}>"
