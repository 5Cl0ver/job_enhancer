"""Scout results you can see, at your level (spec 012).

- resume_tracks.levels: the job levels to look for (default Entry + Mid).
- resume_tracks.years: the user's years of experience, for the level cap.
- scout_findings: short facts Claude read on the page (location, level, years
  asked, posted, in area), Claude's own score before the level cap, where the
  title came from, and when the user passed on it.
- scout_companies.last_openings: the openings Claude saw on the careers page.

New columns with defaults or nullable: nothing existing changes.

Revision ID: j8e9f0a1b2c4
Revises: i7d8e9f0a1b3
Create Date: 2026-11-20
"""

import sqlalchemy as sa

from alembic import op

revision = "j8e9f0a1b2c4"
down_revision = "i7d8e9f0a1b3"
branch_labels = None
depends_on = None

FINDING_COLUMNS = (
    ("location", sa.String(120)),
    ("level", sa.String(10)),
    ("years_asked", sa.SmallInteger()),
    ("posted", sa.String(40)),
    ("in_area", sa.Boolean()),
    ("claude_fit", sa.SmallInteger()),
    ("passed_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.add_column(
        "resume_tracks",
        sa.Column(
            "levels", sa.JSON(), nullable=False, server_default='["entry", "mid"]'
        ),
    )
    op.add_column("resume_tracks", sa.Column("years", sa.SmallInteger(), nullable=True))
    for name, type_ in FINDING_COLUMNS:
        op.add_column("scout_findings", sa.Column(name, type_, nullable=True))
    op.add_column(
        "scout_findings",
        sa.Column("facts_from", sa.String(10), nullable=False, server_default="copy"),
    )
    op.add_column(
        "scout_companies", sa.Column("last_openings", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("scout_companies", "last_openings")
    op.drop_column("scout_findings", "facts_from")
    for name, _ in reversed(FINDING_COLUMNS):
        op.drop_column("scout_findings", name)
    op.drop_column("resume_tracks", "years")
    op.drop_column("resume_tracks", "levels")
