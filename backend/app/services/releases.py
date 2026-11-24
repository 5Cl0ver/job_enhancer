"""The newest Job Catcher release (spec 019, research R3).

The release workflow publishes ``job-catcher-v<version>`` on GitHub with
``job-catcher.zip`` and ``latest.json`` (version, notes, sha256). One cached
call every 10 minutes keeps us far under GitHub's unauthenticated limit; when
GitHub can't be reached, the last known answer stands.
"""

import logging
import re
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

REPO = "5Cl0ver/job_enhancer"
TAG_PREFIX = "job-catcher-v"
DOWNLOAD_URL = f"https://github.com/{REPO}/releases/latest/download/job-catcher.zip"
CACHE_SECONDS = 600
_VERSION = re.compile(r"^\d+(\.\d+){1,3}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

_cache: dict[str, Any] = {"next": 0.0, "value": None}


def _empty() -> dict[str, Any]:
    return {
        "version": None,
        "notes": "",
        "published_at": None,
        "sha256": None,
        "download_url": DOWNLOAD_URL,
    }


def version_tuple(v: str | None) -> tuple[int, ...]:
    if not v or not _VERSION.match(v):
        return ()
    return tuple(int(p) for p in v.split("."))


def is_older(have: str | None, latest: str | None) -> bool:
    a, b = version_tuple(have), version_tuple(latest)
    return bool(a and b and a < b)


async def _fetch() -> dict[str, Any] | None:
    async with httpx.AsyncClient(
        timeout=8.0, headers={"Accept": "application/vnd.github+json"}
    ) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{REPO}/releases", params={"per_page": 20}
        )
        resp.raise_for_status()
        releases = [
            r
            for r in resp.json()
            if isinstance(r, dict)
            and str(r.get("tag_name", "")).startswith(TAG_PREFIX)
            and not r.get("draft")
            and not r.get("prerelease")
        ]
        best: dict[str, Any] | None = None
        for r in releases:
            v = str(r["tag_name"])[len(TAG_PREFIX) :]
            if version_tuple(v) and (
                best is None or version_tuple(v) > version_tuple(best["version"])
            ):
                best = {"version": v, "release": r}
        if best is None:
            return None
        release = best["release"]
        info = _empty() | {
            "version": best["version"],
            "notes": str(release.get("body") or "")[:500],
            "published_at": release.get("published_at"),
        }
        asset = next(
            (a for a in release.get("assets") or [] if a.get("name") == "latest.json"),
            None,
        )
        if asset and asset.get("browser_download_url"):
            meta = await client.get(
                asset["browser_download_url"], follow_redirects=True
            )
            if meta.status_code == 200:
                data = meta.json()
                notes = data.get("notes")
                if isinstance(notes, str) and notes:
                    info["notes"] = notes[:500]
                sha = str(data.get("sha256") or "").lower()
                if _SHA256.match(sha):
                    info["sha256"] = sha
        return info


async def latest() -> dict[str, Any]:
    """The newest release, cached for 10 minutes; the last known on failure."""
    now = time.monotonic()
    if now < _cache["next"]:
        return _cache["value"] or _empty()
    try:
        info = await _fetch()
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Job Catcher release check failed: %s", type(exc).__name__)
        info = None
    if info is not None:
        _cache.update(next=now + CACHE_SECONDS, value=info)
    else:
        # Keep the last good answer; try GitHub again in a minute, not per request.
        _cache["next"] = now + 60
    return _cache["value"] or _empty()


def reset_cache() -> None:
    _cache.update(next=0.0, value=None)
