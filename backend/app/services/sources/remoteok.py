"""RemoteOK source adapter.

Free, keyless feed of remote jobs (requires a User-Agent header). No keyword
search, so it's a **feed source** driven by scheduled ingestion. The first array
element is a legal notice, which we skip. Docs: https://remoteok.com/api
"""

import logging
from typing import Any

import httpx

from app.services.sources.base import HTTP_TIMEOUT, JobSource, parse_dt, strip_html

logger = logging.getLogger(__name__)

_BASE = "https://remoteok.com/api"
_UA = "JobEnhancer/1.0 (+https://github.com/5Cl0ver/job_enhancer)"


class RemoteOKSource(JobSource):
    name = "remoteok"

    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,  # noqa: ARG002 — no keyword search (feed source)
        location: str | None,  # noqa: ARG002
        page: int,
        page_size: int,  # noqa: ARG002
    ) -> list[dict[str, Any]]:
        if page > 1:
            return []
        try:
            resp = await client.get(
                _BASE, headers={"User-Agent": _UA}, timeout=HTTP_TIMEOUT
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("RemoteOK fetch failed: %s", exc)
            return []
        # First element is a legal notice (no "id"); keep only real jobs.
        return [x for x in data if isinstance(x, dict) and x.get("id")]

    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        try:
            title = (raw.get("position") or "").strip()
            company = (raw.get("company") or "").strip()
            if not title or not company:
                return None

            return {
                "external_id": f"remoteok_{raw['id']}",
                "source": self.name,
                "title": title,
                "company": company,
                "location": (raw.get("location") or "").strip() or "Remote",
                "is_remote": True,
                "description": strip_html(raw.get("description") or "")[:2000] or None,
                "salary_min": raw.get("salary_min") or None,
                "salary_max": raw.get("salary_max") or None,
                "currency": "USD",
                "job_type": None,
                "apply_url": raw.get("url") or raw.get("apply_url") or "",
                "posted_at": parse_dt(raw.get("date")),
                "expires_at": None,
            }
        except (KeyError, TypeError) as exc:
            logger.debug("RemoteOK parse error: %s | raw=%s", exc, raw)
            return None
