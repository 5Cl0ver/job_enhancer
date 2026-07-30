"""Pluggable job-source adapters.

Each source implements two methods:
  - ``fetch()``  — call the source's API and return raw records. It must **never
    raise** — log and return ``[]`` on failure, so one bad/slow source can't
    break a whole search.
  - ``parse()``  — normalize ONE raw record into our internal listing dict, or
    return ``None`` to skip it.

Adding a board = one new adapter file, registered in ``__init__.py``. Every
source's output flows through the shared dedup + upsert in ``job_search.py``, so
one real job becomes one row no matter how many sources surface it.

See docs/job-data-architecture.md for the bigger picture.
"""

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

#: Shared HTTP timeout for all source fetches (seconds).
HTTP_TIMEOUT = 10.0


def parse_dt(value: str | None) -> datetime | None:
    """Parse an ISO-8601 timestamp, tolerant of a trailing ``Z``."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


class JobSource(ABC):
    """Base class for a job-listing source."""

    #: Stable identifier; also stored on ``JobListing.source``.
    name: str = ""

    @abstractmethod
    async def fetch(
        self,
        client: httpx.AsyncClient,
        q: str,
        location: str | None,
        page: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        """Return raw source records. Must not raise — return ``[]`` on error."""
        raise NotImplementedError

    @abstractmethod
    def parse(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        """Normalize one raw record into our listing dict, or ``None`` to skip."""
        raise NotImplementedError
