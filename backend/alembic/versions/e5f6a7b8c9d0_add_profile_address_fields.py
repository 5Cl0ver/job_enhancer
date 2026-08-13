"""add street/line2/postal address fields to application_profiles

These let the extension's universal autofill fill full mailing-address forms
(Amazon Jobs, Workday, company sites) — city/state/country already existed.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-10
"""

import sqlalchemy as sa

from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "application_profiles",
        sa.Column("address_line1", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "application_profiles",
        sa.Column("address_line2", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "application_profiles",
        sa.Column("postal_code", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("application_profiles", "postal_code")
    op.drop_column("application_profiles", "address_line2")
    op.drop_column("application_profiles", "address_line1")
