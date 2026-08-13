"""fix saved_jobs.last_stage_change missing server default

The column was created NOT NULL but without a DB default, so inserts that
relied on the model's server_default sent NULL and violated the constraint
(manual/extension saves failed, masked as a 409). Align the DB with the model.

Revision ID: a1b2c3d4e5f6
Revises: 6d32186f6f5a
Create Date: 2026-08-01

"""

import sqlalchemy as sa

from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "6d32186f6f5a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Backfill any rows that somehow have NULL (defensive; expected: none).
    op.execute(
        "UPDATE saved_jobs SET last_stage_change = now() WHERE last_stage_change IS NULL"
    )
    op.alter_column(
        "saved_jobs",
        "last_stage_change",
        server_default=sa.text("now()"),
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "saved_jobs",
        "last_stage_change",
        server_default=None,
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
    )
