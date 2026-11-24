"""The résumé chosen for a saved job (spec 020)

Revision ID: o3d4e5f6a7b9
Revises: n2c3d4e5f6a8
Create Date: 2026-11-24

Job Catcher uploads and fills from this résumé when applying to the job; null
keeps the résumé type's, else the active one. Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "o3d4e5f6a7b9"
down_revision = "n2c3d4e5f6a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.add_column(
            sa.Column("resume_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch.create_foreign_key(
            "fk_saved_jobs_resume_id",
            "resumes",
            ["resume_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.drop_constraint("fk_saved_jobs_resume_id", type_="foreignkey")
        batch.drop_column("resume_id")
