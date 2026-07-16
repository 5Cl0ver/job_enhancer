"""Saved searches: CRUD, scheduled refresh, and the New Matches feed (FR-024)."""

import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.job_listing import JobListing
from app.models.saved_search import SavedSearch
from app.schemas.job import JobListingSchema
from app.schemas.saved_search import (
    NewMatchesResponse,
    SavedSearchCreate,
    SavedSearchSchema,
    SearchMatches,
)
from app.services.job_search import aggregate_and_deduplicate, build_listing_query

logger = logging.getLogger(__name__)

#: Cap on active saved searches per user — keeps the daily refresh cheap.
MAX_SAVED_SEARCHES_PER_USER = 10

#: Cap on searches refreshed per scheduler run (free-tier API budgets).
MAX_REFRESH_PER_RUN = 50

#: How many new jobs to show per search in the feed.
FEED_LIMIT_PER_SEARCH = 10


def _default_name(data: SavedSearchCreate) -> str:
    parts = [data.q]
    if data.location:
        parts.append(data.location)
    if data.remote_only:
        parts.append("remote")
    return " · ".join(parts)[:255]


async def list_saved_searches(
    db: AsyncSession, user_id: uuid.UUID
) -> Sequence[SavedSearch]:
    stmt = (
        select(SavedSearch)
        .where(SavedSearch.user_id == user_id, SavedSearch.is_active.is_(True))
        .order_by(SavedSearch.created_at.desc())
    )
    return (await db.execute(stmt)).scalars().all()


async def create_saved_search(
    db: AsyncSession, user_id: uuid.UUID, data: SavedSearchCreate
) -> SavedSearch:
    count = await db.scalar(
        select(func.count())
        .select_from(SavedSearch)
        .where(SavedSearch.user_id == user_id, SavedSearch.is_active.is_(True))
    )
    if (count or 0) >= MAX_SAVED_SEARCHES_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Limit of {MAX_SAVED_SEARCHES_PER_USER} saved searches reached",
        )

    search = SavedSearch(
        id=uuid.uuid4(),
        user_id=user_id,
        name=data.name or _default_name(data),
        q=data.q,
        location=data.location,
        remote_only=data.remote_only,
        salary_min=data.salary_min,
        salary_max=data.salary_max,
        experience=data.experience,
        job_type=data.job_type,
        last_viewed_at=datetime.now(UTC),
    )
    db.add(search)
    await db.flush()
    return search


async def delete_saved_search(
    db: AsyncSession, search_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    search = await db.scalar(
        select(SavedSearch).where(
            SavedSearch.id == search_id, SavedSearch.user_id == user_id
        )
    )
    if not search:
        raise HTTPException(status_code=404, detail="Saved search not found")
    await db.delete(search)
    await db.flush()


async def get_new_matches(db: AsyncSession, user_id: uuid.UUID) -> NewMatchesResponse:
    """Jobs discovered since each search was last viewed."""
    searches = await list_saved_searches(db, user_id)
    matches: list[SearchMatches] = []
    total = 0

    for search in searches:
        since = search.last_viewed_at or search.created_at
        stmt = (
            build_listing_query(
                q=search.q,
                location=search.location,
                remote_only=search.remote_only,
                salary_min=search.salary_min,
                salary_max=search.salary_max,
                experience=search.experience,
                job_type=search.job_type,
            )
            .where(JobListing.created_at > since)
            .order_by(JobListing.created_at.desc())
        )

        count_stmt = stmt.with_only_columns(func.count()).order_by(None)
        new_count = (await db.scalar(count_stmt)) or 0
        rows = (await db.execute(stmt.limit(FEED_LIMIT_PER_SEARCH))).scalars().all()

        total += new_count
        matches.append(
            SearchMatches(
                search=SavedSearchSchema.model_validate(search),
                new_jobs=[JobListingSchema.model_validate(r) for r in rows],
                new_count=new_count,
            )
        )

    return NewMatchesResponse(matches=matches, total_new=total)


async def mark_matches_seen(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(SavedSearch)
        .where(SavedSearch.user_id == user_id)
        .values(last_viewed_at=datetime.now(UTC))
    )
    await db.flush()


async def refresh_saved_searches(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Scheduled daily: re-run every active saved search (Adzuna only).

    JSearch stays out of scheduled refreshes — its free tier is a hard
    200 requests/month, reserved for interactive searches.
    """
    async with session_factory() as db:
        searches = (
            (
                await db.execute(
                    select(SavedSearch).where(SavedSearch.is_active.is_(True))
                )
            )
            .scalars()
            .all()
        )

        if len(searches) > MAX_REFRESH_PER_RUN:
            logger.warning(
                "Refreshing %d of %d saved searches (per-run cap)",
                MAX_REFRESH_PER_RUN,
                len(searches),
            )
            searches = searches[:MAX_REFRESH_PER_RUN]

        refreshed = 0
        for search in searches:
            try:
                await aggregate_and_deduplicate(
                    db=db,
                    q=search.q,
                    location=search.location,
                    remote_only=search.remote_only,
                    salary_min=search.salary_min,
                    salary_max=search.salary_max,
                    experience=search.experience,
                    job_type=search.job_type,
                    page=1,
                    page_size=20,
                    sources=frozenset({"adzuna"}),
                )
                search.last_run_at = datetime.now(UTC)
                refreshed += 1
            except Exception:
                logger.exception("Saved-search refresh failed: %s", search.id)
        await db.commit()

    logger.info("Refreshed %d saved search(es)", refreshed)
    return refreshed
