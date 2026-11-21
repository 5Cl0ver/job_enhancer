"""Claude Scout casts a wider, correctly placed net.

- resume_tracks.related_titles: other titles to search for too.
- resume_tracks.exact_titles: search titles as exact phrases (off by default).
- resume_tracks.rules_changed_at: when titles, skills or skip rules last
  changed, so jobs scored below the bar before then can be looked at again.
- scout_missions.linkedin_geo_id: LinkedIn's id for the search's place.

New columns with defaults or nullable: nothing existing changes.

Revision ID: i7d8e9f0a1b3
Revises: h6c7d8e9f0a2
Create Date: 2026-11-20
"""

import sqlalchemy as sa

from alembic import op

revision = "i7d8e9f0a1b3"
down_revision = "h6c7d8e9f0a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resume_tracks",
        sa.Column("related_titles", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "resume_tracks",
        sa.Column(
            "exact_titles", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "resume_tracks",
        sa.Column("rules_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "scout_missions", sa.Column("linkedin_geo_id", sa.String(20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("scout_missions", "linkedin_geo_id")
    op.drop_column("resume_tracks", "rules_changed_at")
    op.drop_column("resume_tracks", "exact_titles")
    op.drop_column("resume_tracks", "related_titles")
