"""Jobicy source adapter.

Free, keyless remote-jobs API **with keyword search** (via the ``tag`` param),
so it works as a live per-search source. Docs: https://jobicy.com/jobs-rss-feed
"""

import logging
from typing import Any

import httpx

from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt, strip_html

logger = logging.getLogger(__name__)

_BASE = "https://jobicy.com/api/v2/remote-jobs"

_JOB_TYPE_MAP = {
    "full-time": "FULLTIME",
    "part-time": "PARTTIME",
    "contract": "CONTRACT",
    "freelance": "CONTRACT",
    "internship": "INTERNSHIP",
}


class JobicySource(JobSource):
    name = "jobicy"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,
        location: str | None,  # noqa: ARG002 — Jobicy has no location filter
        page: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        if page > 1:
            return []
        params: dict[str, Any] = {"count": min(page_size, 50)}
        if q:
            params["tag"] = q
        try:
            resp = await client.get(_BASE, params=params, timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            return resp.json().get("jobs", [])
        except Exception as exc:
            logger.warning("Jobicy fetch failed: %s", exc)
            return []

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        try:
            title = (raw.get("jobTitle") or "").strip()
            company = (raw.get("companyName") or "").strip()
            if not title or not company:
                return None

            job_types = raw.get("jobType") or []
            job_type = _JOB_TYPE_MAP.get(job_types[0].lower()) if job_types else None

            return {
                "external_id": f"jobicy_{raw['id']}",
                "source": self.name,
                "title": title,
                "company": company,
                "location": raw.get("jobGeo") or "Remote",
                "is_remote": True,
                "description": strip_html(raw.get("jobDescription") or "")[:2000]
                or None,
                "salary_min": raw.get("salaryMin") or None,
                "salary_max": raw.get("salaryMax") or None,
                "currency": raw.get("salaryCurrency") or "USD",
                "job_type": job_type,
                "apply_url": raw.get("url") or "",
                "posted_at": parse_dt(raw.get("pubDate")),
                "expires_at": None,
            }
        except (KeyError, TypeError, IndexError) as exc:
            logger.debug("Jobicy parse error: %s | raw=%s", exc, raw)
            return None
