"""Problems Claude ran into (spec 030)

Revision ID: y3b4c5d6e7f9
Revises: y3c5e7a9b1d2
Create Date: 2026-11-25

- apply_runs.problems: what went wrong during an application, as Claude
  reported it for the developer ([{id, at, kind, what, page, count}], at most
  20 a run). Existing runs get an empty list.
Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "y3b4c5d6e7f9"
down_revision = "y3c5e7a9b1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.add_column(
            sa.Column("problems", sa.JSON(), nullable=False, server_default="[]")
        )


def downgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("problems")
