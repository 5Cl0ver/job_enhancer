"""Deduplication service for job listings.

Two-phase strategy:
  Phase 1 — Exact: SHA-256 hash of (title_norm + company_norm + location_norm).
             DB unique constraint on content_hash prevents exact duplicates.
  Phase 2 — Fuzzy: rapidfuzz token_sort_ratio against recent listings in the
             same normalized company bucket (title ≥88, company ≥85).
"""

import hashlib
import re

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_listing import JobListing

_NON_ALPHA = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")

# Fuzzy thresholds (tuned against manual inspection of Adzuna + JSearch overlap)
_TITLE_THRESHOLD = 88
_COMPANY_THRESHOLD = 85
# Max candidates to compare per company bucket (keeps queries cheap)
_FUZZY_CANDIDATE_LIMIT = 50


def normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = _NON_ALPHA.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    return text


def job_content_hash(title_norm: str, company_norm: str, location_norm: str) -> str:
    """SHA-256 hex digest of normalised title + company + location."""
    raw = f"{title_norm}|{company_norm}|{location_norm}"
    return hashlib.sha256(raw.encode()).hexdigest()


async def is_duplicate(
    db: AsyncSession,
    title_norm: str,
    company_norm: str,
    *,
    exclude_hash: str | None = None,
) -> bool:
    """Return True if a fuzzy duplicate already exists in the DB.

    Checks only listings where company_normalized matches closely (≥85).
    The exact-hash check is handled separately by the DB unique constraint.
    """
    # Pull candidates from the same company bucket
    stmt = (
        select(JobListing.title_normalized, JobListing.company_normalized)
        .where(JobListing.company_normalized == company_norm)
        .limit(_FUZZY_CANDIDATE_LIMIT)
    )
    if exclude_hash:
        stmt = stmt.where(JobListing.content_hash != exclude_hash)

    rows = (await db.execute(stmt)).all()

    for row_title, row_company in rows:
        company_score = fuzz.token_sort_ratio(company_norm, row_company)
        if company_score < _COMPANY_THRESHOLD:
            continue
        title_score = fuzz.token_sort_ratio(title_norm, row_title)
        if title_score >= _TITLE_THRESHOLD:
            return True

    return False
