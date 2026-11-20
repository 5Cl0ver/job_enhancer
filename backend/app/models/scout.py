"""Claude Scout ORM models: saved searches, runs, what each run found, and the
exact page copies the extension captured.

A "Local companies" search has no job board: Claude finds businesses near the
user on Google and checks each one's own careers page. A **company** row is
the memory of which ones were checked, when, and what was there, so each run
mostly visits new ones and only goes back to one after a week.

A **pass** is a results row Claude passed over because its title didn't fit
the resume type: kept for a while so later runs don't weigh the same row again.

An **instruction version** is a user's edit of what Claude is told (spec 010);
a **run event** is one connector call in a run's log.

A broad search ("Anything I'd be good at") lets Claude choose which job titles
to search from the user's resume; a **title** row remembers, per search, how
each title did, so later runs keep the ones that work and try new ones.

The app is the agent's memory (research R8): Claude in Chrome keeps nothing
between chats. A **mission** is a saved search setup; Start queues a **run**;
every job a run reports becomes a **finding** (the dedupe memory, kept even when
the job wasn't saved); a **capture** is the posting exactly as the Job Catcher
extension read it off the page, which is what gets saved (research R9).
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
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

SOURCES = ("linkedin", "indeed", "ziprecruiter", "google_jobs", "local_companies")
# Searches that look around a place, so they need one.
LOCAL = "local_companies"
# Searches whose postings are on any site, not one job board: only while one of
# these is running does the extension copy pages beyond the three boards.
ANY_SITE_SOURCES = ("google_jobs", LOCAL)
REMOTE_RULES = ("any", "remote_only", "no_remote")

RUN_QUEUED = "queued"
RUN_RUNNING = "running"
RUN_DONE = "done"
RUN_STOPPED = "stopped"

SAVED = "saved"
BELOW_BAR = "below_bar"
DUPLICATE = "duplicate"
WAITING = "waiting_for_copy"
NO_COPY = "no_copy"
# A good fit waiting for the user to confirm it, and one they passed on.
PICKED = "picked"
SKIPPED = "skipped"

# What a company's own careers page had when it was last checked.
COMPANY_OPENINGS = "openings"
COMPANY_NONE = "none"
COMPANY_NO_CAREERS = "no_careers"
COMPANY_RESULTS = (COMPANY_OPENINGS, COMPANY_NONE, COMPANY_NO_CAREERS)

# How long a row Claude passed over by its title stays passed over.
PASS_DAYS = 30


def _now_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def _user_col() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class ScoutMission(Base):
    """A saved search: where to look, for which resume type, how many, how new."""

    __tablename__ = "scout_missions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("resume_tracks.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    posted_within_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    min_pay: Mapped[int | None] = mapped_column(Integer)  # yearly USD
    location: Mapped[str | None] = mapped_column(String(120))
    # "Within N miles" of ``location``; null = the job board's own default.
    radius_miles: Mapped[int | None] = mapped_column(Integer)
    remote: Mapped[str] = mapped_column(String(20), nullable=False, default="any")
    min_fit: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=6)
    extra_instructions: Mapped[str | None] = mapped_column(Text)
    # Where good fits are saved; null = a collection named after the resume type.
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="SET NULL")
    )
    # Save good fits without asking first (a search left to run unattended).
    auto_save: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # A broad search's overrides: {"always": [...], "never": [...], "avoid": [...]}.
    # Null or empty = Claude decides on its own.
    overrides: Mapped[dict | None] = mapped_column(JSON)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now_col()


class ScoutRun(Base):
    """One launch of a mission. ``criteria`` snapshots the mission and its
    resume type at Start, so editing them later doesn't change a past run."""

    __tablename__ = "scout_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scout_missions.id", ondelete="SET NULL")
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_tracks.id", ondelete="SET NULL")
    )
    criteria: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    playbook_version: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=RUN_QUEUED)
    note: Mapped[str | None] = mapped_column(Text)  # Claude's end note
    # Running totals of the result rows Claude checked and why some were passed
    # over: {"rows", "in_tracker", "seen_before", "excluded", "title_passed",
    # "pages"}. Counts only.
    stats: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = _now_col()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScoutCapture(Base):
    """A posting exactly as it appeared on the page, captured by the extension
    while a run was open. Nothing in it comes from Claude."""

    __tablename__ = "scout_captures"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scout_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    url_key: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    is_remote: Mapped[bool] = mapped_column(nullable=False, default=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    salary_period: Mapped[str | None] = mapped_column(String(10))
    job_type: Mapped[str | None] = mapped_column(String(50))
    via: Mapped[str | None] = mapped_column(String(20))
    captured_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        UniqueConstraint("run_id", "url_key", name="uq_scout_capture_run_url"),
    )


class ScoutFinding(Base):
    """Every job a run reported: the memory that stops repeats. Kept whatever
    the outcome (saved, below the bar, duplicate, no page copy)."""

    __tablename__ = "scout_findings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scout_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_tracks.id", ondelete="SET NULL")
    )
    saved_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_jobs.id", ondelete="SET NULL")
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    url_key: Mapped[str] = mapped_column(String(500), nullable=False)
    # From the page copy; empty while the copy hasn't arrived.
    company: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    company_key: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    title_key: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Claude's opinion, shown labelled as Claude's.
    fit_score: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    why_fit: Mapped[str] = mapped_column(Text, nullable=False, default="")
    gaps: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # The app's own reason when it set the outcome (e.g. pay under the minimum).
    app_note: Mapped[str | None] = mapped_column(String(200))
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    # Broad searches: the searched title this good fit is credited to, and the
    # user's resume type Claude said it's closest to.
    search_title: Mapped[str | None] = mapped_column(String(200))
    closest_track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_tracks.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        Index("ix_scout_findings_user_job", "user_id", "company_key", "title_key"),
        Index("ix_scout_findings_user_url", "user_id", "url_key"),
    )


class ScoutCompany(Base):
    """A local company a "Local companies" search checked: one row per user
    and company website. Only names and links, never job text."""

    __tablename__ = "scout_companies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    # The website's domain ("brambleworks.example"), or the company's name key
    # when it has no website.
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    website: Mapped[str | None] = mapped_column(String(500))
    careers_url: Mapped[str | None] = mapped_column(String(2000))
    # Null = due for a check on the next run (never checked, or "check next run").
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    times_checked: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_result: Mapped[str | None] = mapped_column(String(20))
    # The user said never to check this one.
    never_check: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_scout_company_user_key"),
    )


class ScoutPass(Base):
    """A results row Claude passed over because its title didn't fit the resume
    type, so later runs for that resume type skip it without weighing it again.
    Keys only, never job text; rows older than ``PASS_DAYS`` don't count."""

    __tablename__ = "scout_passes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    # A title that doesn't fit one resume type may fit another.
    track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("resume_tracks.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_key: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    title_key: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    url_key: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        Index("ix_scout_passes_track_title", "track_id", "title_key"),
        Index("ix_scout_passes_track_url", "track_id", "url_key"),
    )


class ScoutTitle(Base):
    """A job title a broad search tried: how many runs searched it and how many
    good fits it found. Titles only, never job text."""

    __tablename__ = "scout_titles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    mission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scout_missions.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    title_key: Mapped[str] = mapped_column(String(200), nullable=False)
    runs: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    good_fits: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_tried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        UniqueConstraint("mission_id", "title_key", name="uq_scout_title_mission_key"),
    )


class ScoutInstructionVersion(Base):
    """One saved version of one part of what Claude Scout tells Claude, for one
    user (spec 010). The latest per key is current; a null body is a reset to
    the original."""

    __tablename__ = "scout_instruction_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    key: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    # The original this edit was made from (to say when the original changed).
    base_hash: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = _now_col()

    __table_args__ = (
        Index("ix_scout_instruction_versions_user_key", "user_id", "key", "created_at"),
    )


class ScoutRunEvent(Base):
    """One connector call during a run: what Claude sent and what the app
    answered, trimmed (spec 010). Never the resume or the instruction texts."""

    __tablename__ = "scout_run_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scout_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tool: Mapped[str] = mapped_column(String(40), nullable=False)
    summary: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    request: Mapped[dict | None] = mapped_column(JSON)
    response: Mapped[dict | None] = mapped_column(JSON)
    ok: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = _now_col()
