"""claude scout: saved searches, runs, findings, page copies

- scout_missions: saved search setups (source, resume type, count, recency…).
- scout_runs: each Start; ``criteria`` snapshots the search at launch.
- scout_captures: the exact posting the extension read off the page.
- scout_findings: every job a run reported (the memory that stops repeats).

Additive only. Downgrade drops the four tables.

Revision ID: a8b9c0d1e2f4
Revises: f7a8b9c0d1e3
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a8b9c0d1e2f4"
down_revision = "f7a8b9c0d1e3"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_TABLES = ("scout_missions", "scout_runs", "scout_captures", "scout_findings")


def _id() -> sa.Column:
    return sa.Column("id", _UUID, primary_key=True)


def _user() -> sa.Column:
    return sa.Column(
        "user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


def _now(name: str) -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "scout_missions",
        _id(),
        _user(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column(
            "track_id",
            _UUID,
            sa.ForeignKey("resume_tracks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("job_count", sa.Integer(), nullable=False),
        sa.Column("posted_within_days", sa.Integer(), nullable=False),
        sa.Column("min_pay", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(120), nullable=True),
        sa.Column("remote", sa.String(20), nullable=False),
        sa.Column("min_fit", sa.SmallInteger(), nullable=False),
        sa.Column("extra_instructions", sa.Text(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        _now("created_at"),
    )
    op.create_table(
        "scout_runs",
        _id(),
        _user(),
        sa.Column(
            "mission_id",
            _UUID,
            sa.ForeignKey("scout_missions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "track_id",
            _UUID,
            sa.ForeignKey("resume_tracks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("criteria", sa.JSON(), nullable=False),
        sa.Column("playbook_version", sa.String(20), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        _now("created_at"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "scout_captures",
        _id(),
        _user(),
        sa.Column(
            "run_id",
            _UUID,
            sa.ForeignKey("scout_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url_key", sa.String(500), nullable=False),
        sa.Column("url", sa.String(2000), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("is_remote", sa.Boolean(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("salary_min", sa.Integer(), nullable=True),
        sa.Column("salary_max", sa.Integer(), nullable=True),
        sa.Column("salary_period", sa.String(10), nullable=True),
        sa.Column("job_type", sa.String(50), nullable=True),
        sa.Column("via", sa.String(20), nullable=True),
        _now("captured_at"),
        sa.UniqueConstraint("run_id", "url_key", name="uq_scout_capture_run_url"),
    )
    op.create_table(
        "scout_findings",
        _id(),
        _user(),
        sa.Column(
            "run_id",
            _UUID,
            sa.ForeignKey("scout_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "track_id",
            _UUID,
            sa.ForeignKey("resume_tracks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "saved_job_id",
            _UUID,
            sa.ForeignKey("saved_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("url", sa.String(2000), nullable=False),
        sa.Column("url_key", sa.String(500), nullable=False),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("company_key", sa.String(255), nullable=False),
        sa.Column("title_key", sa.String(500), nullable=False),
        sa.Column("fit_score", sa.SmallInteger(), nullable=False),
        sa.Column("why_fit", sa.Text(), nullable=False),
        sa.Column("gaps", sa.Text(), nullable=False),
        sa.Column("app_note", sa.String(200), nullable=True),
        sa.Column("outcome", sa.String(20), nullable=False),
        _now("created_at"),
    )
    for table in _TABLES:
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])
    op.create_index("ix_scout_findings_run_id", "scout_findings", ["run_id"])
    op.create_index(
        "ix_scout_findings_user_job",
        "scout_findings",
        ["user_id", "company_key", "title_key"],
    )
    op.create_index(
        "ix_scout_findings_user_url", "scout_findings", ["user_id", "url_key"]
    )
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        for table in _TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)
