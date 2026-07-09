"""Job search service — fetches from Adzuna and JSearch, deduplicates, persists.

External API notes:
  - Adzuna: generous free tier, but descriptions are snippets (~200 chars).
  - JSearch (RapidAPI): 200 req/month free, returns full descriptions.
  Both APIs are called in parallel; results are merged and deduplicated before DB
  upsert so we never surface stale data.
"""

import asyncio
import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.job_listing import JobListing
from app.schemas.job import JobListingSchema, JobSearchResponse, PaginatedMeta
from app.services.dedup import is_duplicate, job_content_hash, normalize

logger = logging.getLogger(__name__)

_ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"
_JSEARCH_BASE = "https://jsearch.p.rapidapi.com/search"
_HTTP_TIMEOUT = 10.0  # seconds


# ---------------------------------------------------------------------------
# Adzuna fetcher
# ---------------------------------------------------------------------------


async def _search_adzuna(
    client: httpx.AsyncClient,
    q: str,
    location: str | None,
    page: int,
    page_size: int,
) -> list[dict[str, Any]]:
    country = "us"
    url = f"{_ADZUNA_BASE}/{country}/search/{page}"
    params: dict[str, Any] = {
        "app_id": settings.adzuna_app_id,
        "app_key": settings.adzuna_app_key,
        "results_per_page": min(page_size, 50),
        "what": q,
        "content-type": "application/json",
    }
    if location:
        params["where"] = location

    try:
        resp = await client.get(url, params=params, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("results", [])
    except Exception as exc:
        logger.warning("Adzuna search failed: %s", exc)
        return []


def _parse_adzuna(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise an Adzuna result dict into our internal format."""
    try:
        title = raw.get("title", "").strip()
        company = raw["company"].get("display_name", "").strip()
        if not title or not company:
            return None

        location_parts = raw.get("location", {}).get("display_name", "")
        is_remote = "remote" in location_parts.lower()

        salary_min = raw.get("salary_min")
        salary_max = raw.get("salary_max")

        return {
            "external_id": f"adzuna_{raw['id']}",
            "source": "adzuna",
            "title": title,
            "company": company,
            "location": location_parts,
            "is_remote": is_remote,
            "description": raw.get("description", "").strip() or None,
            "salary_min": int(salary_min) if salary_min else None,
            "salary_max": int(salary_max) if salary_max else None,
            "currency": "GBP" if raw.get("__CLASS__") == "Job" else "USD",
            "job_type": raw.get("contract_type"),
            "apply_url": raw.get("redirect_url", ""),
            "posted_at": _parse_dt(raw.get("created")),
            "expires_at": None,
        }
    except (KeyError, TypeError) as exc:
        logger.debug("Adzuna parse error: %s | raw=%s", exc, raw)
        return None


# ---------------------------------------------------------------------------
# JSearch fetcher
# ---------------------------------------------------------------------------


async def _search_jsearch(
    client: httpx.AsyncClient,
    q: str,
    location: str | None,
    page: int,
    page_size: int,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "query": f"{q} {location or ''}".strip(),
        "page": str(page),
        "num_pages": "1",
    }
    headers = {
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
        "x-rapidapi-key": settings.jsearch_api_key,
    }
    try:
        resp = await client.get(
            _JSEARCH_BASE, params=params, headers=headers, timeout=_HTTP_TIMEOUT
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
    except Exception as exc:
        logger.warning("JSearch search failed: %s", exc)
        return []


def _parse_jsearch(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise a JSearch result dict into our internal format."""
    try:
        title = raw.get("job_title", "").strip()
        company = raw.get("employer_name", "").strip()
        if not title or not company:
            return None

        location = ", ".join(
            filter(None, [raw.get("job_city"), raw.get("job_state"), raw.get("job_country")])
        )
        is_remote = bool(raw.get("job_is_remote"))

        return {
            "external_id": f"jsearch_{raw['job_id']}",
            "source": "jsearch",
            "title": title,
            "company": company,
            "location": location,
            "is_remote": is_remote,
            "description": raw.get("job_description", "").strip() or None,
            "salary_min": raw.get("job_min_salary"),
            "salary_max": raw.get("job_max_salary"),
            "currency": raw.get("job_salary_currency") or "USD",
            "job_type": raw.get("job_employment_type"),
            "apply_url": raw.get("job_apply_link", ""),
            "posted_at": _parse_dt(raw.get("job_posted_at_datetime_utc")),
            "expires_at": None,
        }
    except (KeyError, TypeError) as exc:
        logger.debug("JSearch parse error: %s | raw=%s", exc, raw)
        return None


# ---------------------------------------------------------------------------
# Aggregation & persistence
# ---------------------------------------------------------------------------


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


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


async def aggregate_and_deduplicate(
    db: AsyncSession,
    q: str,
    location: str | None = None,
    remote_only: bool = False,
    salary_min: int | None = None,
    job_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> JobSearchResponse:
    """Search both APIs in parallel, deduplicate, persist new listings, return page."""
    async with httpx.AsyncClient() as client:
        adzuna_task = _search_adzuna(client, q, location, page, page_size)
        jsearch_task = _search_jsearch(client, q, location, page, page_size)
        adzuna_raw, jsearch_raw = await asyncio.gather(adzuna_task, jsearch_task)

    parsed: list[dict[str, Any]] = []
    for raw in adzuna_raw:
        item = _parse_adzuna(raw)
        if item:
            parsed.append(item)
    for raw in jsearch_raw:
        item = _parse_jsearch(raw)
        if item:
            parsed.append(item)

    # Persist new listings (duplicates silently skipped)
    for item in parsed:
        await _upsert_listing(db, item)
    await db.commit()

    # Now query DB with filters for the requested page
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
    if job_type:
        stmt = stmt.where(JobListing.job_type == job_type)

    # Count total
    from sqlalchemy import func

    count_stmt = stmt.with_only_columns(func.count()).order_by(None)
    total = (await db.scalar(count_stmt)) or 0

    # Paginate
    offset = (page - 1) * page_size
    stmt = stmt.order_by(JobListing.posted_at.desc().nullslast()).offset(offset).limit(page_size)
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
