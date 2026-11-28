"""Keep the server awake (spec 040).

Render's free plan puts the server to sleep after 15 minutes with no visits,
and waking it takes about a minute: Claude's side panel then sat on "Loading
tools…" and the first message hung. GitHub's scheduled keep-alive ping is
meant to run every 10 minutes, but GitHub runs it every few hours at best.
So the server visits its own public address every 10 minutes too. Render sets
RENDER_EXTERNAL_URL; anywhere else (tests, a laptop) this does nothing.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)

EVERY_MINUTES = 10


def public_url() -> str | None:
    url = (os.environ.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
    return url if url.startswith("https://") else None


async def ping() -> bool:
    """One visit to /health through the public address. Never raises."""
    url = public_url()
    if not url:
        return False
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{url}/health")
        return resp.status_code == 200
    except httpx.HTTPError:
        log.info("Keep-warm ping didn't get through", exc_info=True)
        return False
