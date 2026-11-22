"""Remember which saved jobs an email update is NOT about (spec 014).

- detected_events.not_jobs: saved-job ids the user said "Wrong job" to for
  this email, so the app never places it (or later emails from the same
  sender or company) on those jobs again.

A new nullable column: nothing existing changes.

Revision ID: k9f0a1b2c3d5
Revises: j8e9f0a1b2c4
Create Date: 2026-11-22
"""

import sqlalchemy as sa

from alembic import op

revision = "k9f0a1b2c3d5"
down_revision = "j8e9f0a1b2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("detected_events", sa.Column("not_jobs", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("detected_events", "not_jobs")
