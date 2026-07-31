"""Job search + aggregation service.

Fetches from pluggable job **sources** (``app/services/sources/``), deduplicates
across them, persists to the shared ``job_listings`` pool, and serves paginated,
filtered results from the DB. This module is source-agnostic — new boards are
added as adapters in the sources package, not here.

See docs/job-data-architecture.md for the ingestion-vs-search design.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from app.models.job_listing import JobListing
from app.schemas.job import JobListingSchema, JobSearchResponse, PaginatedMeta
from app.services.dedup import is_duplicate, job_content_hash, normalize
from app.services.sources import get_sources

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Persistence (dedup + upsert)
# ---------------------------------------------------------------------------


async def _upsert_listing(db: AsyncSession, data: dict[str, Any]) -> JobListing | None:
    """Insert a job listing if not already present (exact or fuzzy duplicate)."""
    title_norm = normalize(data["title"])
    company_norm = normalize(data["company"])
    location_norm = normalize(data["location"])
    content_hash = job_content_hash(title_norm, company_norm, location_norm)

    # Check exact duplicate via content_hash
    existing = await db.scalar(
        select(JobListing).where(JobListing.content_hash == content_hash)
    )
    if existing:
        # Re-seen in a source feed — it's alive
        existing.refreshed_at = datetime.now(UTC)
        existing.is_expired = False
        return existing

    # Check fuzzy duplicate
    if await is_duplicate(db, title_norm, company_norm):
        return None

    listing = JobListing(
        id=uuid.uuid4(),
        content_hash=content_hash,
        title_normalized=title_norm,
        company_normalized=company_norm,
        **data,
    )
    db.add(listing)
    try:
        await db.flush()
    except Exception as exc:
        # Unique constraint violation on concurrent insert — treat as duplicate
        logger.debug("Upsert conflict (concurrent insert): %s", exc)
        await db.rollback()
        return None
    return listing


# ---------------------------------------------------------------------------
# Filtered query (shared by search + saved-search feeds)
# ---------------------------------------------------------------------------

# Title markers used for the experience-level filter (FR-003). Sources don't
# expose a reliable seniority field, so we classify by title keywords.
_SENIOR_MARKERS = [
    "senior",
    "sr.",
    "sr ",
    "lead ",
    "principal",
    "staff ",
    "head of",
    "director",
]
_JUNIOR_MARKERS = ["junior", "jr.", "jr ", "entry", "intern", "graduate", "trainee"]


def _experience_clause(experience: str) -> "ColumnElement[bool]":
    """SQLAlchemy filter clause for entry/mid/senior title classification."""
    from sqlalchemy import and_, not_, or_

    senior = or_(*[JobListing.title.ilike(f"%{m}%") for m in _SENIOR_MARKERS])
    junior = or_(*[JobListing.title.ilike(f"%{m}%") for m in _JUNIOR_MARKERS])

    if experience == "senior":
        return senior
    if experience == "entry":
        return not_(senior)
    # mid: no explicit seniority marker either way
    return and_(not_(senior), not_(junior))


def build_listing_query(
    q: str | None = None,
    location: str | None = None,
    remote_only: bool = False,
    salary_min: int | None = None,
    salary_max: int | None = None,
    experience: str | None = None,
    job_type: str | None = None,
) -> Select[tuple[JobListing]]:
    """Filtered SELECT over non-expired listings (shared by search + feeds)."""
    stmt = select(JobListing).where(JobListing.is_expired.is_(False))

    if q:
        stmt = stmt.where(
            JobListing.title.ilike(f"%{q}%") | JobListing.description.ilike(f"%{q}%")
        )
    if location:
        stmt = stmt.where(JobListing.location.ilike(f"%{location}%"))
    if remote_only:
        stmt = stmt.where(JobListing.is_remote.is_(True))
    if salary_min is not None:
        stmt = stmt.where(JobListing.salary_min >= salary_min)
    if salary_max is not None:
        # Range overlap: exclude jobs whose floor already exceeds the cap
        stmt = stmt.where(
            (JobListing.salary_min <= salary_max) | (JobListing.salary_min.is_(None))
        )
    if experience:
        stmt = stmt.where(_experience_clause(experience))
    if job_type:
        stmt = stmt.where(JobListing.job_type == job_type)
    return stmt


# ---------------------------------------------------------------------------
# Aggregation (ingest from sources) + paginated search
# ---------------------------------------------------------------------------


async def aggregate_and_deduplicate(
    db: AsyncSession,
    q: str,
    location: str | None = None,
    remote_only: bool = False,
    salary_min: int | None = None,
    salary_max: int | None = None,
    experience: str | None = None,
    job_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
    sources: frozenset[str] = frozenset({"adzuna", "jsearch", "remotive"}),
) -> JobSearchResponse:
    """Fetch the selected sources in parallel, deduplicate, persist, return page.

    `sources` names which adapters to hit (see ``app/services/sources/``); e.g.
    scheduled refreshes can stay Adzuna-only to respect the JSearch monthly quota.
    """
    active = get_sources(sources)

    async with httpx.AsyncClient() as client:
        raw_lists = await asyncio.gather(
            *(source.fetch(client, q, location, page, page_size) for source in active)
        )

    # Parse each source's raw records into our internal shape
    parsed: list[dict[str, Any]] = []
    for source, raw_list in zip(active, raw_lists, strict=True):
        for raw in raw_list:
            item = source.parse(raw)
            if item:
                parsed.append(item)

    # Persist new listings (duplicates silently skipped)
    for item in parsed:
        await _upsert_listing(db, item)
    await db.commit()

    # Query the DB with filters for the requested page
    stmt = build_listing_query(
        q=q,
        location=location,
        remote_only=remote_only,
        salary_min=salary_min,
        salary_max=salary_max,
        experience=experience,
        job_type=job_type,
    )

    count_stmt = stmt.with_only_columns(func.count()).order_by(None)
    total = (await db.scalar(count_stmt)) or 0

    offset = (page - 1) * page_size
    stmt = (
        stmt.order_by(JobListing.posted_at.desc().nullslast())
        .offset(offset)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().all()

    total_pages = max(1, -(-total // page_size))  # ceiling division
    return JobSearchResponse(
        results=[JobListingSchema.model_validate(r) for r in rows],
        meta=PaginatedMeta(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# Scheduled background ingestion (populate the pool off the request path)
# ---------------------------------------------------------------------------

#: Common searches used to keep the pool broadly populated across many fields
#: (keyword sources). Deliberately not tech-only — this is a general job app.
CURATED_QUERIES = [
    "software engineer",
    "web developer",
    "data analyst",
    "product manager",
    "graphic designer",
    "marketing manager",
    "sales representative",
    "customer support",
    "accountant",
    "registered nurse",
    "project manager",
    "writer",
]

#: Keyword-searchable sources run per curated query. JSearch is excluded — its
#: ~200/month free quota is too small for a scheduled fan-out.
_INGEST_QUERY_SOURCES = frozenset({"adzuna", "remotive"})

#: Feed sources (no keyword search) fetched once per run.
_INGEST_FEED_SOURCES = frozenset({"themuse"})


async def ingest_curated_jobs(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Populate the shared job pool in the background (cache-first search).

    Runs each curated query through the keyword sources and pulls the feed
    sources once, deduplicating everything into ``job_listings``. This moves API
    fetching OFF the user's request path so searches read a fast, pre-populated
    DB. Runs on a schedule via APScheduler; see docs/job-data-architecture.md.
    """
    query_sources = get_sources(_INGEST_QUERY_SOURCES)
    feed_sources = get_sources(_INGEST_FEED_SOURCES)

    async with session_factory() as db, httpx.AsyncClient() as client:
        before = await db.scalar(select(func.count()).select_from(JobListing)) or 0

        # Keyword sources: one pass per curated query
        for query in CURATED_QUERIES:
            if not query_sources:
                break
            raw_lists = await asyncio.gather(
                *(s.fetch(client, query, None, 1, 50) for s in query_sources)
            )
            for source, raw_list in zip(query_sources, raw_lists, strict=True):
                for raw in raw_list:
                    item = source.parse(raw)
                    if item:
                        await _upsert_listing(db, item)
            await db.commit()

        # Feed sources: fetched once (query is ignored by these sources)
        for source in feed_sources:
            for raw in await source.fetch(client, "", None, 1, 50):
                item = source.parse(raw)
                if item:
                    await _upsert_listing(db, item)
            await db.commit()

        after = await db.scalar(select(func.count()).select_from(JobListing)) or 0

    new_count = after - before
    logger.info("Curated ingest: %d new listing(s) added (pool now %d)", new_count, after)
    return new_count


# ---------------------------------------------------------------------------
# Listing freshness / expiry (scheduled)
# ---------------------------------------------------------------------------

#: Listings not seen in any source feed for this long are marked expired.
EXPIRY_STALE_DAYS = 30


async def mark_expired_listings(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Mark listings expired when past `expires_at` or stale (spec Edge Case).

    Saved jobs and tracking data are preserved — expired listings simply
    drop out of search/feeds and show a "Listing expired" badge.
    Runs daily via APScheduler.
    """
    from datetime import timedelta

    from sqlalchemy import or_, update

    now = datetime.now(UTC)
    stale_cutoff = now - timedelta(days=EXPIRY_STALE_DAYS)

    async with session_factory() as db:
        result = await db.execute(
            update(JobListing)
            .where(
                JobListing.is_expired.is_(False),
                or_(
                    JobListing.expires_at.is_not(None) & (JobListing.expires_at < now),
                    JobListing.refreshed_at < stale_cutoff,
                ),
            )
            .values(is_expired=True)
        )
        await db.commit()

    count = result.rowcount or 0
    if count:
        logger.info("Marked %d listing(s) as expired", count)
    return count
