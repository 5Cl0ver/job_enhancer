"""When an email was sent, and how far around a place a Scout search reaches.

- detected_events.email_date: the email's own date, so "Moved for you" can say
  when it arrived rather than when a scan found it. Null for emails recorded
  before this (their date was never stored).
- scout_missions.radius_miles: "within N miles" of the search's city; null
  leaves it to the job board's own default.

Both are new nullable columns: nothing existing changes.

Revision ID: b9c0d1e2f3a5
Revises: a8b9c0d1e2f4
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "b9c0d1e2f3a5"
down_revision = "a8b9c0d1e2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "detected_events",
        sa.Column("email_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "scout_missions", sa.Column("radius_miles", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    with op.batch_alter_table("scout_missions") as batch:
        batch.drop_column("radius_miles")
    with op.batch_alter_table("detected_events") as batch:
        batch.drop_column("email_date")
