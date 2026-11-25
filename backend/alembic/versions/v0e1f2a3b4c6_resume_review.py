"""Résumés you can see, shape and talk over (spec 025)

Revision ID: v0e1f2a3b4c6
Revises: u9d0e1f2a3b5
Create Date: 2026-11-25

- users.review_resumes: pause Apply with Claude at "Review your résumé"
  after Claude writes it (on by default).
- apply_runs.resume_picked: the user picked an existing résumé at the start,
  so Claude skips the questions, the writing and the review.
- apply_runs.resume_check: the résumé review ({round, decision, note, at,
  read}).
- uq_apply_runs_one_open is rebuilt to count the new open status
  "resume_review" (one open run per user, held by the database).
Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "v0e1f2a3b4c6"
down_revision = "u9d0e1f2a3b5"
branch_labels = None
depends_on = None

# Frozen copies (a migration never changes with the app's code).
_OPEN_BEFORE = (
    "status IN ('waiting', 'reading', 'questions', 'writing', 'filling', "
    "'needs_you', 'review', 'submitting')"
)
_OPEN = (
    "status IN ('waiting', 'reading', 'questions', 'writing', 'resume_review', "
    "'filling', 'needs_you', 'review', 'submitting')"
)


def _one_open(where: str) -> None:
    op.create_index(
        "uq_apply_runs_one_open",
        "apply_runs",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text(where),
        sqlite_where=sa.text(where),
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "review_resumes", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.add_column(
        "apply_runs",
        sa.Column(
            "resume_picked", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column("apply_runs", sa.Column("resume_check", sa.JSON(), nullable=True))
    op.drop_index("uq_apply_runs_one_open", table_name="apply_runs")
    _one_open(_OPEN)


def downgrade() -> None:
    # A run in the new status ends as stopped, so the old index holds.
    op.execute(
        "UPDATE apply_runs SET status = 'stopped' WHERE status = 'resume_review'"
    )
    op.drop_index("uq_apply_runs_one_open", table_name="apply_runs")
    _one_open(_OPEN_BEFORE)
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("resume_check")
        batch.drop_column("resume_picked")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("review_resumes")
