"""add saved_jobs.flagged_for_research — the "Contact Further" research flag

A job can be flagged for company research (who to contact, hiring managers)
WHILE still living in its normal pipeline stage — a shortlist, not a stage.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_jobs",
        sa.Column(
            "flagged_for_research",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("saved_jobs", "flagged_for_research")
