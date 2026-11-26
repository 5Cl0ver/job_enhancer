"""Apply with Claude: see everything, fix at the end (spec 033)

Revision ID: b6c7d8e9f0a2
Revises: a5b6c7d8e9f1
Create Date: 2026-11-26

- apply_runs.sheet: one growing sheet of every box, by step ({} for runs
  from before: the app builds it from their pages).
- apply_runs.fixes: the owner's changes, waiting for a checkpoint ([]).
- apply_runs.mode: "page" (Page by page, the default) or "keep". Runs Claude
  already started get "keep": Claude in them never learned to pause, so they
  carry on as before. Runs pressed but not started yet get the new default.
- apply_runs.paused_step: the step the owner is looking over (null).
- apply_runs.live_changed_at: Job Catcher last saw the page change (null).
Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "b6c7d8e9f0a2"
down_revision = "a5b6c7d8e9f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.add_column(
            sa.Column("sheet", sa.JSON(), nullable=False, server_default="{}")
        )
        batch.add_column(
            sa.Column("fixes", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column(
                "mode", sa.String(length=10), nullable=False, server_default="page"
            )
        )
        batch.add_column(sa.Column("paused_step", sa.String(length=200)))
        batch.add_column(
            sa.Column("live_changed_at", sa.DateTime(timezone=True), nullable=True)
        )
    op.execute(
        "UPDATE apply_runs SET mode = 'keep' "
        "WHERE status NOT IN ('waiting', 'sent', 'not_sent', 'stopped')"
    )


def downgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("live_changed_at")
        batch.drop_column("paused_step")
        batch.drop_column("mode")
        batch.drop_column("fixes")
        batch.drop_column("sheet")
