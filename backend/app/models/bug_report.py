"""Bugs & ideas ORM models (spec 032): the owner's one inbox.

A **report** is one bug or idea, in one format whatever its source (the owner,
the owner's AI, Claude during an Apply with Claude run, or the app catching its
own errors). It holds the current state; there is no user column, so a caught
report never says who hit it.

An **event** is one thing that happened to a report, in an append-only log:
``seen`` (it happened again), ``status``, ``edit``, ``note``, ``merge``,
``split``, ``link``, ``unlink``. History, notes and recent occurrences all come
from it (research R2).

A **link** is "related to" between two reports, stored once with
``a_id < b_id``.

A **shot** is a screenshot on a report, kept as bytes like ``apply_photos``
(research R1). Its routes come in part B; the table is here so part B needs no
migration.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

BUG = "bug"
IDEA = "idea"
TYPES = (BUG, IDEA)
SECTIONS = ("app", "job_catcher", "email", "scout", "apply", "other")
SEVERITIES = ("blocker", "major", "minor")
BUG_STATUSES = ("new", "confirmed", "working", "fixed", "wont_fix")
IDEA_STATUSES = ("new", "planned", "done", "no")
BUG_OPEN = ("new", "confirmed", "working")
IDEA_OPEN = ("new", "planned")
SOURCES = ("owner", "owner_ai", "run", "caught")
CONFIDENCE = ("sure", "not_sure")
EVENT_KINDS = ("seen", "status", "edit", "note", "merge", "split", "link", "unlink")
ACTORS = ("owner", "claude", "app")


def _now_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def _report_fk(nullable: bool = False, ondelete: str = "CASCADE") -> Mapped:
    return mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bug_reports.id", ondelete=ondelete),
        nullable=nullable,
        index=True,
    )


class BugReport(Base):
    __tablename__ = "bug_reports"
    __table_args__ = (Index("ix_bug_reports_status_type", "status", "type"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    type: Mapped[str] = mapped_column(String(10), nullable=False, default=BUG)
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    section: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="manual")
    place: Mapped[str | None] = mapped_column(String(300))
    box: Mapped[str | None] = mapped_column(String(200))
    steps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    actual: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str | None] = mapped_column(String(10))
    confidence: Mapped[str] = mapped_column(String(10), nullable=False, default="sure")
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="owner")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new")
    needs_check: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    fixed_in: Mapped[str | None] = mapped_column(String(60))
    came_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Unique: the same problem is one report, even when two arrive at once.
    fingerprint: Mapped[str | None] = mapped_column(String(16), unique=True, index=True)
    count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    first_seen: Mapped[datetime] = _now_col()
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    # {device, browser, theme, app_version, api_version, job_catcher, playbook}
    context: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("apply_runs.id", ondelete="SET NULL")
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_jobs.id", ondelete="SET NULL")
    )
    # The starting entries (research R11): added once, never again.
    seed_key: Mapped[str | None] = mapped_column(String(40), unique=True)
    # Merged into another report: hidden from every list until split back.
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bug_reports.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _now_col()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<BugReport {self.type} {self.section} {self.title[:30]!r}>"


class BugReportEvent(Base):
    __tablename__ = "bug_report_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    report_id: Mapped[uuid.UUID] = _report_fk()
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    # Who: "owner", "claude" or "app" ("by" in the API; a reserved SQL word).
    actor: Mapped[str] = mapped_column(String(10), nullable=False, default="owner")
    at: Mapped[datetime] = _now_col()
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class BugReportLink(Base):
    __tablename__ = "bug_report_links"

    a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bug_reports.id", ondelete="CASCADE"),
        primary_key=True,
    )
    b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bug_reports.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime] = _now_col()


class BugReportShot(Base):
    __tablename__ = "bug_report_shots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    report_id: Mapped[uuid.UUID] = _report_fk()
    mime: Mapped[str] = mapped_column(String(20), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_at: Mapped[datetime] = _now_col()
