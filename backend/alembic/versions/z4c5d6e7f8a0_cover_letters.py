"""Cover letters, like résumés (spec 031)

Revision ID: z4c5d6e7f8a0
Revises: y3b4c5d6e7f9
Create Date: 2026-11-25

- saved_jobs.cover_letter_id: the cover letter chosen for a job (a written
  document of type "cover_letter"); Job Catcher attaches or pastes it.
- apply_runs.cover_letter_id: the one Claude wrote in an Apply with Claude run.
Both are cleared when the document goes, and both are indexed (a letter's
jobs and runs are found by it). Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "z4c5d6e7f8a0"
down_revision = "y3b4c5d6e7f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("saved_jobs", "apply_runs"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(
                sa.Column(
                    "cover_letter_id", postgresql.UUID(as_uuid=True), nullable=True
                )
            )
            batch.create_foreign_key(
                f"fk_{table}_cover_letter_id",
                "generated_documents",
                ["cover_letter_id"],
                ["id"],
                ondelete="SET NULL",
            )
        op.create_index(
            f"ix_{table}_cover_letter_id", table, ["cover_letter_id"], unique=False
        )


def downgrade() -> None:
    for table in ("apply_runs", "saved_jobs"):
        op.drop_index(f"ix_{table}_cover_letter_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_cover_letter_id", type_="foreignkey")
            batch.drop_column("cover_letter_id")
