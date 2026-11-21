"""Claude Scout's "Local companies" search: which companies to check, and the
memory of the ones already checked.

There's no job board. Claude searches Google for businesses near the user and
sends the companies it lists to ``check``; the app says which to visit. Each run
mostly visits companies never checked before, plus up to ``MAX_RECHECKS_PER_RUN``
checked at least ``RECHECK_DAYS`` ago (ones that had openings first, since they
hire more), so a run doesn't redo last week's work but still catches new
listings. A company the user said never to check is never handed out.

A company is handed out (and counted as checked) the moment the app says to
visit it. Claude then says what was there with ``checked``. One handed out but
not reported yet (the chat ran out) is handed out again to the next chat on
the same run, without counting twice; one reported is never visited twice.

Functions Claude reaches through the connector raise ``ValueError`` with a
message Claude can act on; the page's REST functions raise ``HTTPException``.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scout import (
    COMPANY_NO_CAREERS,
    COMPANY_OPENINGS,
    COMPANY_RESULTS,
    LOCAL,
    ScoutCompany,
    ScoutRun,
)
from app.schemas.scout import CompanyOut, CompanyUpdate
from app.services import scout_instructions as instr
from app.services.scout_dedupe import company_key, is_job_site

RECHECK_DAYS = 7
# The default; each run uses its own (the user can change it, spec 010).
MAX_COMPANIES_PER_RUN = instr.LIMITS["companies"]
MAX_RECHECKS_PER_RUN = 3
MAX_COMPANIES_PER_CHECK = 20

# Hosts where every site is a subdomain: the subdomain is the company.
_SHARED_HOSTS = (
    "wixsite.com",
    "squarespace.com",
    "weebly.com",
    "godaddysites.com",
    "wordpress.com",
    "business.site",
    "myshopify.com",
    "square.site",
    "webflow.io",
    "github.io",
    "herokuapp.com",
    "blogspot.com",
    "azurewebsites.net",
    "netlify.app",
    "vercel.app",
    "pages.dev",
)
_SECOND_LEVEL = ("co", "com", "org", "net", "gov", "edu", "ac")


def _now() -> datetime:
    return datetime.now(UTC)


def _as_link(website: str | None) -> str:
    w = (website or "").strip()
    return w if "//" in w else f"https://{w}"


def site_key(website: str | None) -> str | None:
    """A company website's domain: "https://www.brambleworks.example/about"
    -> "brambleworks.example". None when it isn't a website."""
    if not (website or "").strip():
        return None
    try:
        host = (urlsplit(_as_link(website)).hostname or "").lower()
    except ValueError:
        return None
    host = host.removeprefix("www.")
    labels = host.split(".")
    if len(labels) < 2 or not all(labels):
        return None
    # Towns, counties and school districts: springfield.il.us,
    # district186.k12.il.us. The whole name is the place.
    if labels[-1] == "us" and len(labels) >= 3 and len(labels[-2]) == 2:
        return host
    base = ".".join(labels[-2:])
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL:
        base = ".".join(labels[-3:])  # brambleworks.co.uk
    return host if base in _SHARED_HOSTS else base


def _key(name: str, website: str | None) -> str | None:
    """The company's key: its website's domain, else its name."""
    domain = site_key(website)
    if domain:
        return domain[:255]
    name_key = company_key(name)
    return f"name:{name_key}"[:255] if name_key else None


def _http(url: str | None, limit: int = 2000) -> str | None:
    url = (url or "").strip()
    return url[:limit] if url.lower().startswith(("http://", "https://")) else None


def _website(website: str, key: str) -> str:
    """The link kept for a company (its column holds 500 characters)."""
    return _http(_as_link(website), 500) or f"https://{key}"[:500]


def _due(company: ScoutCompany, now: datetime) -> bool:
    if company.never_check:
        return False
    if company.last_checked_at is None:
        return True
    checked = company.last_checked_at
    if checked.tzinfo is None:  # SQLite hands back naive times
        checked = checked.replace(tzinfo=UTC)
    return checked <= now - timedelta(days=RECHECK_DAYS)


def _stats(run: ScoutRun) -> dict:
    return dict(run.stats or {})


def _reported(stats: dict) -> set[str]:
    """Companies this run has already had a report back on."""
    return set(stats.get("_done", []))


def counts(run: ScoutRun) -> dict:
    """How many companies this run has checked, against its limit."""
    stats = run.stats or {}
    return {
        "checked": stats.get("companies", 0),
        "limit": instr.limit(run.criteria, "companies"),
    }


def _hand_out(
    run: ScoutRun,
    stats: dict,
    company: ScoutCompany,
    *,
    recheck: bool,
) -> None:
    """Count a company as checked by this run, from now. Its last result stays
    until Claude reports a new one."""
    company.last_checked_at = _now()
    company.times_checked = (company.times_checked or 0) + 1
    handed = set(stats.get("_companies", []))
    handed.add(company.key)
    stats["_companies"] = sorted(handed)
    stats["companies"] = len(handed)
    which = "companies_rechecked" if recheck else "companies_new"
    stats[which] = stats.get(which, 0) + 1
    run.stats = stats


def _brief_row(company: ScoutCompany) -> dict:
    row = {"name": company.name, "website": company.website}
    if company.careers_url:
        row["careers_url"] = company.careers_url
    return row


async def _by_keys(
    db: AsyncSession, user_id: uuid.UUID, keys: set[str]
) -> dict[str, ScoutCompany]:
    if not keys:
        return {}
    rows = await db.scalars(
        select(ScoutCompany).where(
            ScoutCompany.user_id == user_id, ScoutCompany.key.in_(keys)
        )
    )
    return {c.key: c for c in rows}


async def rechecks(db: AsyncSession, user_id: uuid.UUID, run: ScoutRun) -> list[dict]:
    """Companies checked before that this run looks at again (for the brief).
    Picked once per run: asking again (a new chat) hands back the same ones."""
    stats = _stats(run)
    if "_recheck" in stats:
        # A later chat on the same run: only the ones not reported back yet.
        left = [k for k in stats["_recheck"] if k not in _reported(stats)]
        known = await _by_keys(db, user_id, set(left))
        return [_brief_row(known[k]) for k in left if k in known]
    cutoff = _now() - timedelta(days=RECHECK_DAYS)
    due = (
        await db.scalars(
            select(ScoutCompany)
            .where(
                ScoutCompany.user_id == user_id,
                ScoutCompany.never_check.is_(False),
                ScoutCompany.times_checked > 0,
                ScoutCompany.last_checked_at.is_(None)
                | (ScoutCompany.last_checked_at <= cutoff),
            )
            .order_by(
                # "Check next run" first, then ones that had openings, then
                # the longest since a look.
                case(
                    (ScoutCompany.last_checked_at.is_(None), 0),
                    (ScoutCompany.last_result == COMPANY_OPENINGS, 1),
                    else_=2,
                ),
                ScoutCompany.last_checked_at,
            )
            .limit(MAX_RECHECKS_PER_RUN)
        )
    ).all()
    for company in due:
        _hand_out(run, stats, company, recheck=True)
    stats["_recheck"] = [c.key for c in due]
    run.stats = stats
    await db.flush()
    return [_brief_row(c) for c in due]


def _visit_row(i: int, company: ScoutCompany) -> dict:
    row: dict = {"i": i}
    if company.careers_url:
        row["careers_url"] = company.careers_url
    return row


async def check(
    db: AsyncSession, user_id: uuid.UUID, run: ScoutRun, companies: list[dict]
) -> dict:
    """Which of the companies a Google search listed to visit now."""
    if (run.criteria or {}).get("source") != LOCAL:
        raise ValueError(
            "check_companies is only for a Local companies search. Send the "
            "rows of a results page to check_jobs instead."
        )
    if len(companies) > MAX_COMPANIES_PER_CHECK:
        raise ValueError(f"Send at most {MAX_COMPANIES_PER_CHECK} companies per call.")
    stats = _stats(run)
    handed = set(stats.get("_companies", []))
    reported = _reported(stats)
    keyed: list[tuple[int, str, str | None, str | None]] = []
    for i, row in enumerate(companies):
        if not isinstance(row, dict):
            row = {}  # counted as having no website
        name = " ".join(str(row.get("name") or "").split())[:255]
        website = str(row.get("website") or "").strip() or None
        keyed.append((i, name, website, _key(name, website) if website else None))
    known = await _by_keys(db, user_id, {k for *_, k in keyed if k})
    now = _now()
    visit: list[dict] = []
    skipped: dict[str, int] = {}
    seen_now: set[str] = set()

    def skip(why: str) -> None:
        skipped[why] = skipped.get(why, 0) + 1

    for i, name, website, key in keyed:
        company = known.get(key) if key else None
        if not website or not key:
            skip("no_website")
        elif is_job_site(_as_link(website)):
            skip("job_site")
        elif key in seen_now or key in reported:
            skip("checked_this_run")
        elif key in handed and company is not None:
            # Handed out earlier in this run but never reported (a new chat):
            # visit it now, without counting it again.
            visit.append(_visit_row(i, company))
        elif company is not None and company.never_check:
            skip("skipped_by_you")
        elif company is not None and not _due(company, now):
            skip("checked_recently")
        elif len(handed) >= instr.limit(run.criteria, "companies"):
            skip("over_the_limit")
        elif company is not None and (
            stats.get("companies_rechecked", 0) >= MAX_RECHECKS_PER_RUN
        ):
            skip("checked_recently")  # enough look-agains this run
        else:
            recheck = company is not None
            if company is None:
                company = ScoutCompany(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    key=key,
                    name=name or key,
                    website=_website(website, key),
                    times_checked=0,
                    never_check=False,
                )
                db.add(company)
                known[key] = company
            elif name:
                company.name = name
            _hand_out(run, stats, company, recheck=recheck)
            handed.add(key)
            visit.append(_visit_row(i, company))
        if key:
            seen_now.add(key)
    await db.flush()
    full = len(handed) >= instr.limit(run.criteria, "companies")
    if visit:
        nxt = (
            'Visit each company in "visit" in turn: find its careers page, send '
            "its openings to check_jobs, report_job the fits, then company_checked."
        )
    elif full:
        nxt = "Company limit reached: call finish_scout_run."
    else:
        nxt = (
            "None new here: try the next start URL or the next page of Google results."
        )
    return {"visit": visit, "skipped": skipped, "companies": counts(run), "next": nxt}


async def checked(
    db: AsyncSession,
    user_id: uuid.UUID,
    run: ScoutRun,
    website: str,
    result: str,
    careers_url: str | None = None,
    name: str = "",
    openings: list | None = None,
) -> dict:
    """Claude says what a company's site had, and which openings it listed
    (titles and links only, kept so the page can show them; spec 012)."""
    if (run.criteria or {}).get("source") != LOCAL:
        raise ValueError("company_checked is only for a Local companies search.")
    if result not in COMPANY_RESULTS:
        raise ValueError(f"result must be one of: {', '.join(COMPANY_RESULTS)}.")
    stats = _stats(run)
    key = _key(name, website)
    handed = set(stats.get("_companies", []))
    company = (
        (await _by_keys(db, user_id, {key})).get(key) if key and key in handed else None
    )
    if company is None:
        raise ValueError(
            "That company wasn't handed out in this search. Send it to "
            "check_companies first, with the same website."
        )
    company.last_result = result
    company.last_openings = (
        clean_openings(openings) if result == COMPANY_OPENINGS else []
    )
    link = _http(careers_url)
    if result == COMPANY_NO_CAREERS:
        company.careers_url = None
    elif link and not is_job_site(link):
        company.careers_url = link
    stats["_done"] = sorted(_reported(stats) | {key})
    opened = set(stats.get("_openings", []))
    if result == COMPANY_OPENINGS:
        opened.add(key)
    else:
        opened.discard(key)  # a corrected report
    stats["_openings"] = sorted(opened)
    stats["companies_with_openings"] = len(opened)
    run.stats = stats
    await db.flush()
    # Full once every company the run may check has been reported (not just
    # handed out: Claude may still have some to visit).
    full = len(_reported(run.stats)) >= instr.limit(run.criteria, "companies")
    return {
        "recorded": result,
        "companies": counts(run),
        "next": (
            "Company limit reached: call finish_scout_run."
            if full
            else "Go on to the next company, or the next start URL."
        ),
    }


MAX_OPENINGS = 20


def clean_openings(openings) -> list[dict]:
    """Up to ``MAX_OPENINGS`` {title, url, fit}: titles cut short, links that
    are web addresses, fit 0-10 or null. Never job text."""
    out: list[dict] = []
    for o in openings if isinstance(openings, list) else []:
        if not isinstance(o, dict):
            continue
        title = " ".join(str(o.get("title") or "").split())[:200]
        url = _http(str(o.get("url") or ""))
        if not title or not url:
            continue
        try:
            fit = int(o.get("fit"))
            fit = fit if 0 <= fit <= 10 else None
        except (TypeError, ValueError):
            fit = None
        out.append({"title": title, "url": url[:2000], "fit": fit})
        if len(out) >= MAX_OPENINGS:
            break
    return out


def summary(stats: dict | None) -> str | None:
    """ "Checked 12 local companies (9 new, 3 re-checked); 4 had openings."""
    stats = stats or {}
    n = stats.get("companies", 0)
    if not n:
        return None
    new, again = stats.get("companies_new", 0), stats.get("companies_rechecked", 0)
    parts = [
        p
        for p in (f"{new} new" if new else "", f"{again} re-checked" if again else "")
        if p
    ]
    head = f"Checked {n} local compan{'ies' if n != 1 else 'y'}"
    if parts:
        head += f" ({', '.join(parts)})"
    hiring = stats.get("companies_with_openings", 0)
    return f"{head}; {hiring} had openings."


# --------------------------------------------------------------------------- #
# The page's side
# --------------------------------------------------------------------------- #
def to_out(companies: Sequence[ScoutCompany]) -> list[CompanyOut]:
    now = _now()
    out = []
    for c in companies:
        item = CompanyOut.model_validate(c)
        item.due = _due(c, now)
        out.append(item)
    return out


async def list_companies(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 300
) -> list[CompanyOut]:
    rows = (
        await db.scalars(
            select(ScoutCompany)
            .where(ScoutCompany.user_id == user_id)
            .order_by(
                ScoutCompany.last_checked_at.desc().nulls_first(),
                ScoutCompany.created_at.desc(),
            )
            .limit(limit)
        )
    ).all()
    return to_out(rows)


async def update_company(
    db: AsyncSession, user_id: uuid.UUID, company_id: uuid.UUID, data: CompanyUpdate
) -> CompanyOut:
    company = await db.scalar(
        select(ScoutCompany).where(
            ScoutCompany.id == company_id, ScoutCompany.user_id == user_id
        )
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    if data.never_check is not None:
        company.never_check = data.never_check
    if data.check_next:
        company.never_check = False
        company.last_checked_at = None
    await db.flush()
    return to_out([company])[0]
