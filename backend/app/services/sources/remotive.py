"""Remotive source adapter.

Free, **keyless** remote-jobs API with keyword search — instant coverage for
remote roles with zero setup. Docs: https://remotive.com/api-documentation
"""

import html as html_lib
import logging
import re
from typing import Any

import httpx

from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt

logger = logging.getLogger(__name__)

_BASE = "https://remotive.com/api/remote-jobs"

# Remotive `job_type` -> our filter values (see frontend SearchFilters JOB_TYPES).
_JOB_TYPE_MAP = {
    "full_time": "FULLTIME",
    "part_time": "PARTTIME",
    "contract": "CONTRACT",
    "freelance": "CONTRACT",
    "internship": "INTERNSHIP",
}


def _strip_html(raw_html: str) -> str:
    """Turn Remotive's HTML description into a plain-text snippet."""
    text = re.sub(r"<[^>]+>", " ", raw_html)
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()


class RemotiveSource(JobSource):
    name = "remotive"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,
        location: str | None,
        page: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        # Remotive returns the most recent matches up to `limit` with no page
        # offset — only fetch on page 1; the DB serves subsequent pages.
        if page > 1:
            return []
        params = {"search": q, "limit": min(page_size, 50)}
        try:
            resp = await client.get(_BASE, params=params, timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            return resp.json().get("jobs", [])
        except Exception as exc:
            logger.warning("Remotive search failed: %s", exc)
            return []

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        try:
            title = (raw.get("title") or "").strip()
            company = (raw.get("company_name") or "").strip()
            if not title or not company:
                return None

            description = _strip_html(raw.get("description") or "") or None
            pub = raw.get("publication_date")

            return {
                "external_id": f"remotive_{raw['id']}",
                "source": self.name,
                "title": title,
                "company": company,
                "location": raw.get("candidate_required_location") or "Remote",
                "is_remote": True,
                "description": description[:2000] if description else None,
                # Remotive salary is free-text (often empty) — skip it.
                "salary_min": None,
                "salary_max": None,
                "currency": "USD",
                "job_type": _JOB_TYPE_MAP.get(raw.get("job_type")),
                "apply_url": raw.get("url", ""),
                "posted_at": parse_dt(f"{pub}Z") if pub else None,
                "expires_at": None,
            }
        except (KeyError, TypeError) as exc:
            logger.debug("Remotive parse error: %s | raw=%s", exc, raw)
            return None
