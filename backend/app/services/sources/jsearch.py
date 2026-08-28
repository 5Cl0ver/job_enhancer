"""JSearch (RapidAPI) source adapter.

Aggregates Google-for-Jobs results (which itself pulls LinkedIn/Indeed/etc.) and
returns full descriptions. Free tier is only ~200 requests/MONTH, so this source
is best reserved for scheduled/broad pulls or occasional deep search — not every
interactive query. Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
"""

import logging
from typing import Any

import httpx

from app.config import settings
from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt

logger = logging.getLogger(__name__)

_BASE = "https://jsearch.p.rapidapi.com/search"
_HOST = "jsearch.p.rapidapi.com"


class JSearchSource(JobSource):
    name = "jsearch"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,
        location: str | None,
        page: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        # No key configured → source disabled; skip the guaranteed-to-fail call.
        if not settings.jsearch_api_key:
            return []
        params: dict[str, Any] = {
            "query": f"{q} {location or ''}".strip(),
            "page": str(page),
            "num_pages": "1",
        }
        headers = {
            "x-rapidapi-host": _HOST,
            "x-rapidapi-key": settings.jsearch_api_key,
        }
        try:
            resp = await client.get(
                _BASE, params=params, headers=headers, timeout=HTTP_TIMEOUT
            )
            resp.raise_for_status()
            return resp.json().get("data", [])
        except Exception as exc:
            logger.warning("JSearch search failed: %s", exc)
            return []

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        try:
            title = raw.get("job_title", "").strip()
            company = raw.get("employer_name", "").strip()
            if not title or not company:
                return None

            location = ", ".join(
                filter(
                    None,
                    [raw.get("job_city"), raw.get("job_state"), raw.get("job_country")],
                )
            )
            is_remote = bool(raw.get("job_is_remote"))

            return {
                "external_id": f"jsearch_{raw['job_id']}",
                "source": self.name,
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
                "posted_at": parse_dt(raw.get("job_posted_at_datetime_utc")),
                "expires_at": None,
            }
        except (KeyError, TypeError) as exc:
            logger.debug("JSearch parse error: %s | raw=%s", exc, raw)
            return None
