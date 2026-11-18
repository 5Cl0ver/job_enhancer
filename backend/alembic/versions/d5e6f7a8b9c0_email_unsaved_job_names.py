"""email updates: names for jobs the user hasn't saved

- detected_events.job_company / job_title: the company and role an email is
  about, read from the email itself, for important updates about a job that
  isn't in the user's saved jobs (status ``unsaved``) and recruiter messages
  (status ``contact``). NULL for everything else.

Existing rows get NULLs. Downgrade drops the two columns (the new statuses are
plain strings and need no schema change).

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-11-05
"""

import sqlalchemy as sa

from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("detected_events") as batch:
        batch.add_column(sa.Column("job_company", sa.String(255), nullable=True))
        batch.add_column(sa.Column("job_title", sa.String(255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("detected_events") as batch:
        batch.drop_column("job_title")
        batch.drop_column("job_company")
