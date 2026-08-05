"""Add job_listings.salary_period ("yearly" | "hourly"; null = yearly legacy).

Hourly listings ($50-$100/hr) were either skipped or would display as annual
figures — the period lets the UI label the pay honestly.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_listings", sa.Column("salary_period", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("job_listings", "salary_period")
