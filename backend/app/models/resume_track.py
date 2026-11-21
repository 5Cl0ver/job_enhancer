"""ResumeTrack ORM model — one "resume type" per kind of role the user targets.

A track says what Claude Scout should look for (target titles, key skills,
what to skip, minimum pay) and which uploaded resume to apply with. Saved jobs
point at the track they were found for (``saved_jobs.track_id``), so applying
means picking up the right resume instead of rewriting one.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class ResumeTrack(Base):
    __tablename__ = "resume_tracks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    target_titles: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    key_skills: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Other titles to search for too ("also search for"), and whether titles
    # are searched as exact phrases (off: each title its own, looser search).
    related_titles: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    exact_titles: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # When the titles, skills or skip rules last changed: jobs scored below the
    # bar before then may be looked at again (spec 011).
    rules_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # {"degree_only": bool, "max_years": int | None, "exclude": [str]}
    skip_rules: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    min_pay: Mapped[int | None] = mapped_column(Integer)  # yearly USD
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "scoped": a resume type the user made. "broad": the hidden one behind
    # Scout's "Anything I'd be good at" search (at most one per user, never
    # listed on the Resume types page).
    kind: Mapped[str] = mapped_column(
        String(10), nullable=False, default="scoped", server_default="scoped"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    resume: Mapped["Resume | None"] = relationship("Resume")  # type: ignore[name-defined]

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_resume_track_user_name"),
    )

    def __repr__(self) -> str:
        return f"<ResumeTrack id={self.id} name={self.name!r} user_id={self.user_id}>"
