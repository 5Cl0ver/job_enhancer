"""add saved_jobs.emailed_at — outreach email tracking

Records when the user sent an outreach email for a job. NULL means not yet
emailed; a timestamp both marks "contacted" and gives the date shown in the UI.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-11
"""

import sqlalchemy as sa

from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_jobs",
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_jobs", "emailed_at")
