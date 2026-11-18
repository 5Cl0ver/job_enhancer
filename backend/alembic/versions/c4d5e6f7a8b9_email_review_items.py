"""email review items: durable needs-review rows with saved evidence

- detected_events.saved_job_id becomes nullable: a needs_review item may not
  have a job until the user picks one.
- detected_events.match_evidence: which evidence chose the job, or why the
  item needs review.
- detected_events.review_candidates: the saved-job ids it could be about.

Existing rows keep their job and get NULL evidence/candidates. Downgrade
refuses while any row has no saved job (resolve or delete those first),
because the old schema can't hold them.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-11-04
"""

import sqlalchemy as sa

from alembic import op

revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None

_NO_JOB_MSG = (
    "cannot downgrade: detected_events has needs-review rows without a saved "
    "job; resolve or delete them first"
)


def _dialect() -> str:
    return op.get_context().dialect.name


def upgrade() -> None:
    with op.batch_alter_table("detected_events") as batch:
        batch.alter_column("saved_job_id", existing_type=sa.UUID(), nullable=True)
        batch.add_column(sa.Column("match_evidence", sa.String(40), nullable=True))
        batch.add_column(sa.Column("review_candidates", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _dialect() == "postgresql":
        op.execute(
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM detected_events "
            "WHERE saved_job_id IS NULL) "
            f"THEN RAISE EXCEPTION '{_NO_JOB_MSG}'; END IF; END $$"
        )
    elif (
        op.get_bind()
        .execute(sa.text("SELECT 1 FROM detected_events WHERE saved_job_id IS NULL"))
        .first()
    ):
        raise RuntimeError(_NO_JOB_MSG)
    with op.batch_alter_table("detected_events") as batch:
        batch.drop_column("review_candidates")
        batch.drop_column("match_evidence")
        batch.alter_column("saved_job_id", existing_type=sa.UUID(), nullable=False)
