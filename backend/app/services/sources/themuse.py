"""The Muse source adapter.

Free, keyless — reaches **non-remote** jobs across many professional categories.
The Muse has no free-text keyword search, so this adapter ignores the query and
pulls recent jobs across **all categories** (every field — not just tech). That
makes it a **feed source**: driven by scheduled background ingestion (which
populates the shared pool), not by live per-search.
Docs: https://www.themuse.com/developers/api/v2
"""

import logging
from typing import Any

import httpx

from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt, strip_html

logger = logging.getLogger(__name__)

_BASE = "https://www.themuse.com/api/public/jobs"

#: How many pages of The Muse's all-category feed to pull per ingest (~20/page).
_MAX_PAGES = 3


class TheMuseSource(JobSource):
    name = "themuse"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,  # noqa: ARG002 — The Muse has no keyword search
        location: str | None,  # noqa: ARG002
        page: int,  # noqa: ARG002 — we pull a fixed range of pages below
        page_size: int,  # noqa: ARG002
    ) -> list[dict[str, Any]]:
        # All categories (no filter), newest-first, a few pages deep.
        jobs: list[dict[str, Any]] = []
        for p in range(1, _MAX_PAGES + 1):
            params = [("page", str(p)), ("descending", "true")]
            try:
                resp = await client.get(_BASE, params=params, timeout=HTTP_TIMEOUT)
                resp.raise_for_status()
                batch = resp.json().get("results", [])
            except Exception as exc:
                logger.warning("The Muse fetch failed (page %d): %s", p, exc)
                break
            if not batch:
                break
            jobs.extend(batch)
        return jobs

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        try:
            title = (raw.get("name") or "").strip()
            company = (raw.get("company") or {}).get("name", "").strip()
            if not title or not company:
                return None

            locations = raw.get("locations") or []
            location = locations[0]["name"] if locations else "Not specified"
            is_remote = any(
                "remote" in (loc.get("name") or "").lower() for loc in locations
            )
            description = strip_html(raw.get("contents") or "") or None

            return {
                "external_id": f"themuse_{raw['id']}",
                "source": self.name,
                "title": title,
                "company": company,
                "location": location,
                "is_remote": is_remote,
                "description": description[:2000] if description else None,
                "salary_min": None,
                "salary_max": None,
                "currency": "USD",
                "job_type": None,
                "apply_url": (raw.get("refs") or {}).get("landing_page", ""),
                "posted_at": parse_dt(raw.get("publication_date")),
                "expires_at": None,
            }
        except (KeyError, TypeError) as exc:
            logger.debug("The Muse parse error: %s | raw=%s", exc, raw)
            return None
