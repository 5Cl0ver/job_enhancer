"""Claude Scout asks before it saves, and each search chooses its collection.

- scout_missions.collection_id: where the search's good fits are saved; null =
  a collection named after its resume type. Cleared if that collection is
  deleted.
- scout_missions.auto_save: save good fits without asking (off by default).
- scout_runs.stats: running totals of the result rows Claude checked and why
  some were passed over, so the page can say why a search came back short.
  Counts only. Null on runs from before this.

New columns only (nullable, or with a default): nothing existing changes. The
two new finding outcomes, "picked" and "skipped", need no schema change.

Revision ID: d1e2f3a4b5c7
Revises: c0d1e2f3a4b6
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d1e2f3a4b5c7"
down_revision = "c0d1e2f3a4b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("scout_missions") as batch:
        batch.add_column(
            sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "auto_save",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch.create_foreign_key(
            "fk_scout_missions_collection_id",
            "collections",
            ["collection_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.add_column("scout_runs", sa.Column("stats", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scout_runs") as batch:
        batch.drop_column("stats")
    with op.batch_alter_table("scout_missions") as batch:
        batch.drop_constraint("fk_scout_missions_collection_id", type_="foreignkey")
        batch.drop_column("auto_save")
        batch.drop_column("collection_id")
