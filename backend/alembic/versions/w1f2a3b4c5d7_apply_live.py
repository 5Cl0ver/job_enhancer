"""Apply with best judgment (spec 026)

Revision ID: w1f2a3b4c5d7
Revises: v0e1f2a3b4c6
Create Date: 2026-11-25

- apply_runs.live: what's in the boxes of the page Claude is filling, as Job
  Catcher reads it every few seconds ({url, title, at, boxes}). Cleared when
  the run stops filling.
Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "w1f2a3b4c5d7"
down_revision = "v0e1f2a3b4c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apply_runs", sa.Column("live", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("live")
