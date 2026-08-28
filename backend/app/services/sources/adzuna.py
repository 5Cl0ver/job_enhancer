"""Adzuna source adapter.

Generous free tier (~250 requests/day). Descriptions are short snippets. Our
primary/workhorse source. Docs: https://developer.adzuna.com/
"""

import logging
from typing import Any

import httpx

from app.config import settings
from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt

logger = logging.getLogger(__name__)

_BASE = "https://api.adzuna.com/v1/api/jobs"
_COUNTRY = "us"


class AdzunaSource(JobSource):
    name = "adzuna"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,
        location: str | None,
        page: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        # No keys configured → source disabled; skip the guaranteed-to-fail call.
        if not settings.adzuna_app_id or not settings.adzuna_app_key:
            return []
        url = f"{_BASE}/{_COUNTRY}/search/{page}"
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
            resp = await client.get(url, params=params, timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            return resp.json().get("results", [])
        except Exception as exc:
            logger.warning("Adzuna search failed: %s", exc)
            return []

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
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
                "source": self.name,
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
                "posted_at": parse_dt(raw.get("created")),
                "expires_at": None,
            }
        except (KeyError, TypeError) as exc:
            logger.debug("Adzuna parse error: %s | raw=%s", exc, raw)
            return None
