"""Languages in the application profile (spec 020)

Revision ID: p4e5f6a7b8c0
Revises: o3d4e5f6a7b9
Create Date: 2026-11-24

A JSON list of {language, native, comprehension, reading, speaking, writing,
overall} with levels 1-5, edited on the app's Autofill memory page and filled
into language blocks by Job Catcher. Additive; null means none given.
"""

import sqlalchemy as sa

from alembic import op

revision = "p4e5f6a7b8c0"
down_revision = "o3d4e5f6a7b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("application_profiles") as batch:
        batch.add_column(sa.Column("languages", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("application_profiles") as batch:
        batch.drop_column("languages")
