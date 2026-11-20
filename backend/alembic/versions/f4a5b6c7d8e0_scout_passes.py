"""Claude Scout remembers the rows it passed over by their title.

scout_passes: one row per results row Claude said didn't fit a resume type by
its title alone, so later runs for that resume type skip it instead of weighing
the same rows again each time. Keys only (company, title, link), never job
text; rows older than 30 days stop counting.

A new table only: nothing existing changes.

Revision ID: f4a5b6c7d8e0
Revises: f3a4b5c6d7e9
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f4a5b6c7d8e0"
down_revision = "f3a4b5c6d7e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scout_passes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "track_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resume_tracks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("company_key", sa.String(255), nullable=False, server_default=""),
        sa.Column("title_key", sa.String(500), nullable=False, server_default=""),
        sa.Column("url_key", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_scout_passes_user_id", "scout_passes", ["user_id"])
    op.create_index(
        "ix_scout_passes_track_title", "scout_passes", ["track_id", "title_key"]
    )
    op.create_index(
        "ix_scout_passes_track_url", "scout_passes", ["track_id", "url_key"]
    )
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE scout_passes ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_scout_passes_track_url", table_name="scout_passes")
    op.drop_index("ix_scout_passes_track_title", table_name="scout_passes")
    op.drop_index("ix_scout_passes_user_id", table_name="scout_passes")
    op.drop_table("scout_passes")
