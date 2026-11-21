"""Claude Scout dedupe keys and posting-link checks (pure; research R3).

Two keys, either one means "seen":

- ``company_key`` + ``title_key``: lowercased, punctuation gone, company legal
  suffixes dropped ("Acme, Inc." == "acme"). Seniority words stay, because a
  Senior role is a different job.
- ``url_key``: the posting's canonical link. Boards put many links on one job
  (tracking params, the job open in a search page's side pane); each maps to one
  key, e.g. ``linkedin.com/jobs/view/123``.
"""

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit

from app.services.dedup import normalize

_COMPANY_SUFFIX = re.compile(
    r"\b(?:inc|incorporated|llc|l l c|corp|corporation|co|company|ltd|limited|"
    r"plc|lp|llp|pc|pllc|the)\b"
)
_TRACKING = re.compile(
    r"^(?:utm_.*|trk.*|refid|ref|src|source|gh_src|lever-source.*|"
    r"tracking.*|from|origin|position|pagenum|ebp|eligibility.*|alid|"
    r"geoid|f_.*|keywords|location|currentjobid|start|sort.*)$",
    re.I,
)


def company_key(company: str) -> str:
    return " ".join(_COMPANY_SUFFIX.sub(" ", normalize(company or "")).split())


def title_key(title: str) -> str:
    return normalize(title or "")


def _host(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.").lower()


MAX_KEY = 500  # the url_key columns' length


def url_key(url: str) -> str | None:
    """One canonical key per posting, or None for a link that isn't http(s).
    Never longer than MAX_KEY: a long link keeps its start plus a hash."""
    key = _url_key(url)
    if key is None or len(key) <= MAX_KEY:
        return key
    digest = hashlib.sha256(key.encode()).hexdigest()[:16]
    return f"{key[: MAX_KEY - 17]}#{digest}"


def _url_key(url: str) -> str | None:
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    host = _host(url)
    path = parts.path.rstrip("/")
    query = dict(parse_qsl(parts.query))

    if host.endswith("linkedin.com"):
        m = re.search(r"/jobs/view/(?:[^/]*-)?(\d+)", path)
        job_id = m.group(1) if m else query.get("currentJobId")
        if job_id and job_id.isdigit():
            return f"linkedin.com/jobs/view/{job_id}"
    if "indeed." in host:
        jk = query.get("jk") or query.get("vjk")
        if jk:
            return f"indeed.com/viewjob?jk={jk.lower()}"
    if host.endswith("ziprecruiter.com"):
        jid = query.get("jid") or query.get("lvk")
        if jid:
            return f"ziprecruiter.com/job?jid={jid}"
    if host.endswith("greenhouse.io"):
        m = re.search(r"/jobs/(\d+)", path)
        gh = m.group(1) if m else query.get("gh_jid")
        if gh:
            return f"greenhouse/{gh}"
    if "gh_jid" in query:
        return f"greenhouse/{query['gh_jid']}"
    # Workday adds a language to the link it lands on ("/en-US/…") and
    # "/apply" while applying: the same posting either way (spec 012).
    if host.endswith(("myworkdayjobs.com", "myworkdaysite.com")):
        wd = re.sub(r"^/[a-z]{2}-[a-z]{2}(?=/)", "", path, flags=re.IGNORECASE)
        return f"{host}{re.sub(r'/apply(?:/.*)?$', '', wd)}"
    # Oleeo (tal.net) links carry the page layout; the job is its /opp/ id.
    if host.endswith("tal.net"):
        m = re.search(r"/opp/(\d+)", path)
        if m:
            return f"{host}/opp/{m.group(1)}"
    if host == "jobs.lever.co" or host == "jobs.ashbyhq.com":
        return f"{host}{path.removesuffix('/apply').removesuffix('/application')}"

    kept = sorted((k, v) for k, v in query.items() if not _TRACKING.match(k))
    return f"{host}{path}" + (f"?{urlencode(kept)}" if kept else "")


# The three job boards Scout searches directly (their pages are always copied
# while a run is open).
BOARD_HOSTS = ("linkedin.com", "indeed.com", "ziprecruiter.com")

# Google's own jobs, on its careers site: a real posting, not a Google page.
_GOOGLE_CAREERS = re.compile(r"^(?:careers\.google\.com|google\.com/about/careers)")

# Job boards, and the directories and review sites a Google search for local
# businesses also lists. A "Local companies" search uses none of them: only
# each company's own site (or the hiring system its careers page runs on).
JOB_SITES = (
    "linkedin.com",
    "indeed.com",
    "ziprecruiter.com",
    "glassdoor.com",
    "monster.com",
    "simplyhired.com",
    "careerbuilder.com",
    "dice.com",
    "snagajob.com",
    "talent.com",
    "jooble.org",
    "lensa.com",
    "adzuna.com",
    "jobright.ai",
    "theladders.com",
    "flexjobs.com",
    "builtin.com",
    "wellfound.com",
    "salary.com",
    "payscale.com",
    "google.com",
    "yelp.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "wikipedia.org",
    "bbb.org",
    "mapquest.com",
    "yellowpages.com",
    "angi.com",
    "nextdoor.com",
    "tripadvisor.com",
    "zoominfo.com",
    "crunchbase.com",
    "manta.com",
    "bizapedia.com",
    "opencorporates.com",
    "dnb.com",
    "chamberofcommerce.com",
)


def is_job_site(url: str) -> bool:
    """A job board, directory or review site: not a company's own site."""
    link = url if "//" in (url or "") else f"https://{url}"
    host = _host(link)
    if _GOOGLE_CAREERS.match(f"{host}{urlsplit(link).path}"):
        return False
    return bool(host) and (
        any(host == d or host.endswith(f".{d}") for d in JOB_SITES)
        # indeed.co.uk, google.ca …
        or bool(re.match(r"^(?:[\w-]+\.)*(?:indeed|google|linkedin)\.[a-z.]+$", host))
    )


def posting_problem(url: str) -> str | None:
    """Why this link isn't one job's own posting page, or None if it is.

    The saved link has to open the job itself: a search page, a list or a
    careers homepage changes or shows other jobs next time it's opened."""
    key = url_key(url)
    if key is None:
        return "That isn't a web link. Send the posting's http(s) link."
    host = _host(url)
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/").lower()

    if host.endswith("linkedin.com") and not key.startswith("linkedin.com/jobs/view/"):
        return (
            "That's a LinkedIn search or list page. Open the job and send its "
            "linkedin.com/jobs/view/… link."
        )
    if "indeed." in host and not key.startswith("indeed.com/viewjob"):
        return "That's an Indeed search page. Open the job and send its viewjob link."
    # A ZipRecruiter job only has a lasting link of its own on its job page
    # (/c/…, /jobs/…, /job/…); a search page with the job open beside it doesn't.
    zip_search = host.endswith("ziprecruiter.com") and not any(
        part in path for part in ("/c/", "/jobs/", "/job/")
    )
    if zip_search:
        return "That's a ZipRecruiter search page. Open the job and send its link."
    # google.com, google.ca, jobs.google.com… (not Google's own careers site)
    google_careers = _GOOGLE_CAREERS.match(f"{host}{path}")
    if ".google." in f".{host}" and not google_careers:
        return (
            "That's a Google page. Open the job's own page (its \"Apply on\" "
            "link, the company's own site first) and send that link."
        )
    # A Workday site's job list, not one job (a job's link has /job/ in it).
    if (
        host.endswith(("myworkdayjobs.com", "myworkdaysite.com"))
        and "/job/" not in path
    ):
        return "That's a Workday job list. Open the job and send its link."
    if path in ("", "/careers", "/jobs", "/careers/jobs", "/join-us", "/about/careers"):
        return "That's a careers homepage, not one job. Open the job and send its link."
    return None


def posting_link(url: str) -> str:
    """The link to save: the job's own page. A LinkedIn or Indeed job open in a
    search page's side pane becomes its standalone job page."""
    key = url_key(url) or ""
    if key.startswith(("linkedin.com/jobs/view/", "indeed.com/viewjob")):
        return f"https://www.{key}"
    return url.strip()
