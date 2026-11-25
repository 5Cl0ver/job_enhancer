"""Every email about a job, kept (spec 027)

Revision ID: x2a3b4c5d6e8
Revises: w1f2a3b4c5d7
Create Date: 2026-11-25

- detected_events.seen_at: when the user saw a noted email (opened its job).
- detected_events.skip_reason: why a skipped email wasn't put on a job.
The new statuses ("noted", "skipped") are plain strings. Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "x2a3b4c5d6e8"
down_revision = "w1f2a3b4c5d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "detected_events",
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "detected_events", sa.Column("skip_reason", sa.String(30), nullable=True)
    )


def downgrade() -> None:
    # Rows only this revision knows how to show go first.
    op.execute("DELETE FROM detected_events WHERE status = 'skipped'")
    op.execute("UPDATE detected_events SET status = 'hidden' WHERE status = 'noted'")
    with op.batch_alter_table("detected_events") as batch:
        batch.drop_column("skip_reason")
        batch.drop_column("seen_at")
