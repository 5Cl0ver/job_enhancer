"""Apply with Claude ORM models (spec 022).

An **apply run** is one application Claude in Chrome makes for one saved job,
start to finish: the questions it asked and the user's answers, the résumé it
wrote, every page it filled (with Job Catcher's photos), the user's review, and
how it ended. Like a Scout run, the app is the memory and the agent keeps
nothing between chats, so a new chat carries on from the run's step.

An **apply request** is something Claude asked Job Catcher to do on the page
(take photos, fill what it knows). It's its own row only so Job Catcher can
claim it atomically and never do it twice.

An **apply photo** is one screenful of an application page, as Job Catcher
saw it. Deleted 30 days after the run ends.

A **profile fact** is something the user told Claude that their résumé doesn't
say ("Yes, I used Intune at Logical Position for 200 laptops"). Claude never
asks it again; the user can edit or delete it in Settings › Résumés.
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
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# Where a run is. Open ones can still change; the last three are the end.
APPLY_WAITING = "waiting"  # pressed, Claude hasn't asked for the brief yet
APPLY_READING = "reading"
APPLY_QUESTIONS = "questions"
APPLY_WRITING = "writing"
# Claude wrote the job's résumé; the user looks it over first (spec 025).
APPLY_RESUME_REVIEW = "resume_review"
APPLY_FILLING = "filling"
APPLY_NEEDS_YOU = "needs_you"
APPLY_REVIEW = "review"
APPLY_SUBMITTING = "submitting"
APPLY_SENT = "sent"
APPLY_NOT_SENT = "not_sent"
APPLY_STOPPED = "stopped"
APPLY_OPEN = (
    APPLY_WAITING,
    APPLY_READING,
    APPLY_QUESTIONS,
    APPLY_WRITING,
    APPLY_RESUME_REVIEW,
    APPLY_FILLING,
    APPLY_NEEDS_YOU,
    APPLY_REVIEW,
    APPLY_SUBMITTING,
)
APPLY_ENDED = (APPLY_SENT, APPLY_NOT_SENT, APPLY_STOPPED)
# One open run per user, held by the database too (two quick presses).
OPEN_SQL = "status IN (" + ", ".join(f"'{s}'" for s in APPLY_OPEN) + ")"

REQUEST_PHOTO = "photo"
REQUEST_FILL = "fill"
REQUEST_PEEK = "peek"  # the screen as it is now, one shot (spec 023)
REQUEST_PENDING = "pending"
REQUEST_WORKING = "working"
REQUEST_DONE = "done"
REQUEST_FAILED = "failed"


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


class ApplyRun(Base):
    __tablename__ = "apply_runs"
    __table_args__ = (
        Index(
            "uq_apply_runs_one_open",
            "user_id",
            unique=True,
            postgresql_where=text(OPEN_SQL),
            sqlite_where=text(OPEN_SQL),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    saved_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("saved_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=APPLY_WAITING
    )
    # [{id, question, why, answer, skipped, source: "app"|"chat", answered_at}]
    questions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # The user pressed "Done, make my résumé" (or told Claude so in the chat).
    answers_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # [{n, url, title, answers: [{q, a, claude}], jc_answers, photo_ids,
    #   photo: "waiting"|"taken"|"missing", reason, at, round, last}]
    pages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    help: Mapped[dict | None] = mapped_column(JSON)  # {kind, what, at, done_at}
    # {round, decision: None|"submit"|"fix"|"self", note, by, at}
    review: Mapped[dict | None] = mapped_column(JSON)
    events: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # The conversation (spec 023): [{id, by: "you"|"claude", text, at, read}].
    messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Hosts Job Catcher's Submit safety net covers (the apply link's, and every
    # page Claude marked done).
    apply_hosts: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL")
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_documents.id", ondelete="SET NULL")
    )
    # The user picked an existing résumé at the start (spec 025): no questions,
    # no writing, no résumé review.
    resume_picked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # The résumé review (spec 025): {round, decision: None|"use"|"change",
    # note, by, words, at, read}.
    resume_check: Mapped[dict | None] = mapped_column(JSON)
    # What's in the boxes of the page being filled, as Job Catcher reads it
    # every few seconds (spec 026): {url, title, at, boxes: [{q, a, by}]}.
    # Only while filling; cleared when the run moves on.
    live: Mapped[dict | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    playbook_version: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = _now_col()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime] = _now_col()
    # Claude's last connector call: "Claude seems to have stopped" (spec 023).
    claude_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApplyRequest(Base):
    __tablename__ = "apply_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("apply_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    page_n: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=REQUEST_PENDING
    )
    result: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = _now_col()
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApplyPhoto(Base):
    __tablename__ = "apply_photos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("apply_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    page_n: Mapped[int] = mapped_column(Integer, nullable=False)
    part: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = _now_col()


class ProfileFact(Base):
    __tablename__ = "profile_facts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = _user_col()
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    saved_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_jobs.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _now_col()
    updated_at: Mapped[datetime] = _now_col()
