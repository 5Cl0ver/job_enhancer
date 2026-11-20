"""Claude Scout's Instructions page and run log.

- scout_instruction_versions: each user's saved versions of what Claude is
  told (main steps, extra steps, scoring, limits). The latest per key is
  current; a null body is a reset to the original.
- scout_run_events: every connector call in a run (what Claude sent, what the
  app answered, trimmed). Never the resume or the instruction texts.

Two new tables only: nothing existing changes.

Revision ID: h6c7d8e9f0a2
Revises: g5b6c7d8e9f1
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "h6c7d8e9f0a2"
down_revision = "g5b6c7d8e9f1"
branch_labels = None
depends_on = None


def _user():
    return sa.Column(
        "user_id",
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )


def _created():
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "scout_instruction_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _user(),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("base_hash", sa.String(16), nullable=True),
        _created(),
    )
    op.create_index(
        "ix_scout_instruction_versions_user_id",
        "scout_instruction_versions",
        ["user_id"],
    )
    op.create_index(
        "ix_scout_instruction_versions_user_key",
        "scout_instruction_versions",
        ["user_id", "key", "created_at"],
    )
    op.create_table(
        "scout_run_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _user(),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scout_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False, server_default=""),
        sa.Column("request", sa.JSON(), nullable=True),
        sa.Column("response", sa.JSON(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        _created(),
    )
    op.create_index("ix_scout_run_events_user_id", "scout_run_events", ["user_id"])
    op.create_index("ix_scout_run_events_run_id", "scout_run_events", ["run_id"])
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE scout_instruction_versions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE scout_run_events ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_scout_run_events_run_id", table_name="scout_run_events")
    op.drop_index("ix_scout_run_events_user_id", table_name="scout_run_events")
    op.drop_table("scout_run_events")
    op.drop_index(
        "ix_scout_instruction_versions_user_key",
        table_name="scout_instruction_versions",
    )
    op.drop_index(
        "ix_scout_instruction_versions_user_id",
        table_name="scout_instruction_versions",
    )
    op.drop_table("scout_instruction_versions")
