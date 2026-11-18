"""email updates: move cards automatically when a scan is sure

- email_accounts.auto_move: the Settings switch. When on, a scan moves a card
  by itself if the email names the job exactly (its link, its job ID, or a
  hiring site's template naming company and role); each such update is stored
  with status ``auto_applied`` and can be undone. Defaults to on.

Existing rows get ``true``. Downgrade drops the column (``auto_applied`` is a
plain status string and needs no schema change).

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-11-17
"""

import sqlalchemy as sa

from alembic import op

revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column(
                "auto_move", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("auto_move")
