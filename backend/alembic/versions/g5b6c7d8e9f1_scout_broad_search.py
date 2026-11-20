"""Claude Scout's "Anything I'd be good at" search.

- resume_tracks.kind: "scoped" (a resume type the user made, every existing
  row) or "broad" (the hidden one behind the broad search).
- scout_missions.overrides: a broad search's Always / Never / Avoid lists.
- scout_findings.search_title / closest_track_id: which searched title a good
  fit is credited to, and the resume type Claude said it's closest to.
- scout_titles: per broad search, each title tried, its runs and good fits.
  Titles only, never job text.

New columns (nullable or with a default) and a new table: nothing existing is
changed or removed.

Revision ID: g5b6c7d8e9f1
Revises: f4a5b6c7d8e0
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "g5b6c7d8e9f1"
down_revision = "f4a5b6c7d8e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resume_tracks",
        sa.Column("kind", sa.String(10), nullable=False, server_default="scoped"),
    )
    op.add_column("scout_missions", sa.Column("overrides", sa.JSON(), nullable=True))
    op.add_column(
        "scout_findings", sa.Column("search_title", sa.String(200), nullable=True)
    )
    with op.batch_alter_table("scout_findings") as batch:
        batch.add_column(
            sa.Column(
                "closest_track_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey(
                    "resume_tracks.id",
                    name="fk_scout_findings_closest_track",
                    ondelete="SET NULL",
                ),
                nullable=True,
            )
        )
    op.create_table(
        "scout_titles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scout_missions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("title_key", sa.String(200), nullable=False),
        sa.Column("runs", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("good_fits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_tried_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "mission_id", "title_key", name="uq_scout_title_mission_key"
        ),
    )
    op.create_index("ix_scout_titles_user_id", "scout_titles", ["user_id"])
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE scout_titles ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_scout_titles_user_id", table_name="scout_titles")
    op.drop_table("scout_titles")
    with op.batch_alter_table("scout_findings") as batch:
        batch.drop_column("closest_track_id")
    op.drop_column("scout_findings", "search_title")
    op.drop_column("scout_missions", "overrides")
    op.drop_column("resume_tracks", "kind")
