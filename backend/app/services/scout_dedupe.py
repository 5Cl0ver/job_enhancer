"""Claude Scout dedupe keys and posting-link checks (pure; research R3).

Two keys, either one means "seen":

- ``company_key`` + ``title_key``: lowercased, punctuation gone, company legal
  suffixes dropped ("Acme, Inc." == "acme"). Seniority words stay, because a
  Senior role is a different job.
- ``url_key``: the posting's canonical link. Boards put many links on one job
  (tracking params, the job open in a search page's side pane); each maps to one
  key, e.g. ``linkedin.com/jobs/view/123``.
"""

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


def url_key(url: str) -> str | None:
    """One canonical key per posting, or None for a link that isn't http(s)."""
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
    if host == "jobs.lever.co" or host == "jobs.ashbyhq.com":
        return f"{host}{path.removesuffix('/apply').removesuffix('/application')}"

    kept = sorted((k, v) for k, v in query.items() if not _TRACKING.match(k))
    return f"{host}{path}" + (f"?{urlencode(kept)}" if kept else "")


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
    zip_search = (
        host.endswith("ziprecruiter.com")
        and not key.startswith("ziprecruiter.com/job?")
        and "/c/" not in path
        and "/jobs/" not in path
    )
    if zip_search:
        return "That's a ZipRecruiter search page. Open the job and send its link."
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
