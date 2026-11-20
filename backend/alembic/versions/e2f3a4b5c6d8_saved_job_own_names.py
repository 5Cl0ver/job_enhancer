"""A saved job's own name: the user's corrections, kept on their saved job.

saved_jobs.custom_title / custom_company / custom_location / custom_apply_url:
set when the user fixes a job's name (or confirms a name the app flagged).
Shown in place of the listing's own values, for this user only. The shared
job_listings row is never edited, so nobody else's job, search results or
duplicate checks change.

New nullable columns only: nothing existing changes.

Revision ID: e2f3a4b5c6d8
Revises: d1e2f3a4b5c7
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "e2f3a4b5c6d8"
down_revision = "d1e2f3a4b5c7"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("custom_title", sa.String(500)),
    ("custom_company", sa.String(255)),
    ("custom_location", sa.String(255)),
    ("custom_apply_url", sa.Text()),
)


def upgrade() -> None:
    for name, kind in _COLUMNS:
        op.add_column("saved_jobs", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        for name, _ in reversed(_COLUMNS):
            batch.drop_column(name)
