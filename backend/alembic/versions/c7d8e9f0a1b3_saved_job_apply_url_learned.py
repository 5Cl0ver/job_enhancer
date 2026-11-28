"""A job's company link Job Catcher learned (spec 040)

Revision ID: c7d8e9f0a1b3
Revises: b6c7d8e9f0a2
Create Date: 2026-11-28

- saved_jobs.apply_url_learned: custom_apply_url was learned by Job Catcher
  (the company's application after an Apply on the job board), not set by
  the user. A later Apply may replace a learned link; the user's own never.
  False for every existing row (they are the user's own).
Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "c7d8e9f0a1b3"
down_revision = "b6c7d8e9f0a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.add_column(
            sa.Column(
                "apply_url_learned",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.drop_column("apply_url_learned")
