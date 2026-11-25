"""Sites to skip (spec 024): the sites a user never wants jobs from.

The list is plain hosts ("learn4good.com"). A site covers its sub-sites
("uk.learn4good.com") but never a look-alike ("evil-learn4good.com"),
research R5. Claude Scout leaves rows on these sites out (``check_jobs``) and
turns down reports of them (``report_job``); Apply with Claude is told to find
the company's own posting instead. All of it is checked here, on the server,
so Claude reads at most one extra line (research R4).

The list is read live, one indexed query per call, so a site added while a run
is going counts from Claude's next call (research R3).
"""

import re
import uuid
from collections.abc import Iterable, Sequence
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scout import ScoutFinding
from app.models.skipped_site import SkippedSite

MAX_SITES = 100
MAX_HOST = 253
# Sites Claude Scout searches: skipping one would empty a whole source, so the
# app asks first (research R6).
SCOUT_SOURCES = {
    "linkedin.com": "LinkedIn",
    "indeed.com": "Indeed",
    "ziprecruiter.com": "ZipRecruiter",
    "google.com": "Google Jobs",
}
# Known reposting sites (research R7). Only the ones in the user's own Scout
# finds are suggested, and never added without a tap.
REPOSTING_SITES = (
    "learn4good.com",
    "jobleads.com",
    "adzuna.com",
    "remoterocketship.com",
    "trabajo.org",
    "recruit.net",
    "talent.com",
    "jooble.org",
    "lensa.com",
    "jobrapido.com",
    "bebee.com",
)
MAX_SUGGESTIONS = 5
_HOST = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$"
)
NOT_A_SITE = "That isn't a site. Paste a link, or a site like learn4good.com."


def link_host(url: str | None) -> str:
    """A link's own site: lowercase, no "www.". Empty for anything else."""
    try:
        host = urlsplit((url or "").strip()).hostname or ""
    except ValueError:
        return ""
    return host.lower().rstrip(".").removeprefix("www.")


def host_of(text: str | None) -> str | None:
    """The site to keep from what the user pasted: a whole link or just a
    name. None when it isn't a site ("hello", a mail link, an address)."""
    raw = (text or "").strip()
    if not raw or len(raw) > 2000 or any(c.isspace() for c in raw):
        return None
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    # "mailto:me@x.com" reads as a sign-in name on x.com: not a site.
    if parts.scheme not in ("http", "https") or "@" in parts.netloc:
        return None
    host = link_host(raw)
    if len(host) > MAX_HOST or not _HOST.match(host):
        return None
    return host


def matches(host: str, site: str) -> bool:
    """The host is the site itself or one of its sub-sites."""
    return bool(host) and bool(site) and (host == site or host.endswith(f".{site}"))


def skipped_by(url: str | None, sites: Iterable[str]) -> str | None:
    """The skipped site this link is on, or None."""
    host = link_host(url)
    if not host:
        return None
    return next((s for s in sites if matches(host, s)), None)


async def hosts(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """The user's sites, A to Z (what Claude is given)."""
    rows = await db.scalars(
        select(SkippedSite.host)
        .where(SkippedSite.user_id == user_id)
        .order_by(SkippedSite.host)
    )
    return list(rows.all())


async def list_sites(db: AsyncSession, user_id: uuid.UUID) -> Sequence[SkippedSite]:
    """The user's sites, newest first (what the app shows)."""
    rows = await db.scalars(
        select(SkippedSite)
        .where(SkippedSite.user_id == user_id)
        .order_by(SkippedSite.created_at.desc(), SkippedSite.host)
    )
    return rows.all()


def _scout_source(host: str) -> str | None:
    for site, name in SCOUT_SOURCES.items():
        if matches(host, site) or matches(site, host):
            return name
    return None


async def add(
    db: AsyncSession, user_id: uuid.UUID, text: str, *, confirm: bool = False
) -> tuple[SkippedSite, bool]:
    """Add a site from a pasted link or name. Returns the row and whether it's
    new; a site already covered (itself, or a site it's part of) isn't added
    again."""
    host = host_of(text)
    if host is None:
        raise HTTPException(status_code=400, detail=NOT_A_SITE)
    rows = await list_sites(db, user_id)
    covering = next((r for r in rows if matches(host, r.host)), None)
    if covering is not None:
        return covering, False
    source = _scout_source(host)
    if source and not confirm:
        raise HTTPException(
            status_code=409,
            detail={
                "needs_confirm": True,
                "why": (
                    f"Claude Scout searches {source}: skipping {host} means "
                    f"your {source} searches bring back nothing."
                ),
            },
        )
    if len(rows) >= MAX_SITES:
        raise HTTPException(
            status_code=400,
            detail=f"You can skip up to {MAX_SITES} sites. Remove one first.",
        )
    site = SkippedSite(id=uuid.uuid4(), user_id=user_id, host=host)
    db.add(site)
    await db.flush()
    await db.refresh(site)
    return site, True


async def remove(db: AsyncSession, user_id: uuid.UUID, site_id: uuid.UUID) -> None:
    site = await db.get(SkippedSite, site_id)
    if site is None or site.user_id != user_id:
        raise HTTPException(status_code=404, detail="That site isn't on your list.")
    await db.delete(site)
    await db.flush()


async def suggestions(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """Known reposting sites that show up in the user's own Scout finds, most
    finds first, minus the ones already skipped. A company's own site is never
    suggested: only sites on the built-in list are."""
    urls = await db.scalars(
        select(ScoutFinding.url).where(
            ScoutFinding.user_id == user_id,
            or_(*(ScoutFinding.url.ilike(f"%{s}%") for s in REPOSTING_SITES)),
        )
    )
    skipped = await hosts(db, user_id)
    finds: dict[str, int] = {}
    for url in urls.all():
        site = skipped_by(url, REPOSTING_SITES)
        if site and not any(matches(site, s) for s in skipped):
            finds[site] = finds.get(site, 0) + 1
    top = sorted(finds.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_SUGGESTIONS]
    return [{"host": host, "finds": n} for host, n in top]


def refusal(site: str) -> str:
    """What report_job tells Claude about a link on a skipped site."""
    return (
        f"{site} is on the user's sites to skip. Use the company's own posting, "
        "or another 'Apply on' link."
    )
