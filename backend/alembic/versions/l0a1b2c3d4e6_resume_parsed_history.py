"""resumes.parsed_history — a résumé read once into work history + education

Revision ID: l0a1b2c3d4e6
Revises: k9f0a1b2c3d5
Create Date: 2026-11-23

Spec 015: autofill fills Workday's experience blocks and education questions
from a reading of the résumé stored on the row, instead of asking the AI on
every press. Additive only.
"""

import sqlalchemy as sa

from alembic import op

revision = "l0a1b2c3d4e6"
down_revision = "k9f0a1b2c3d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resumes", sa.Column("parsed_history", sa.JSON(), nullable=True))
    op.add_column(
        "resumes",
        sa.Column("parsed_history_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resumes", "parsed_history_at")
    op.drop_column("resumes", "parsed_history")
