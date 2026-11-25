"""Match an email to the saved job it's about — ranked evidence, never a guess.

Pure functions (no I/O, no AI). The matcher reads the subject, the sender's
display name, the sender and Reply-To domains, and the FULL cleaned text (the
classifier reads only the newest reply; matching needs the signature, the
footer and any quoted job details too). Evidence is ranked:

1. **Job URL or ID** — the saved job's apply URL, or a job id taken from it,
   appears in the email.
2. **Known sender** — this From/Reply-To address already sent an update about
   that job (shared relay and no-reply addresses never count).
3. **Rare company + title** — the company's distinctive words (or its initials,
   "DHS" for Department of Harbor Services) and the exact job title
   both appear.
4. **Company + date** — the company appears, it is the user's ONLY saved job
   there, and the email isn't from long before the job was saved.

Anything weaker is a *review* item, never an automatic match: a title with no
company, several roles at one company, a near-miss company spelling, or two
jobs with comparable evidence. Common words ("the", "group", "health"…) and
company suffixes are ignored, so one shared word can't make a match.

The same job saved twice ("Acme" and "Acme, Inc.", same title) counts as ONE
job: duplicates are collapsed before matching, so they never cause a review.
An email naming three or more different saved jobs across companies is a
digest (:func:`looks_like_digest`), not an update about one of them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from email.utils import getaddresses, parseaddr
from urllib.parse import parse_qsl, urlsplit

from rapidfuzz import fuzz

from app.services.email_prefilter import is_platform_sender

MATCHED = "matched"
REVIEW = "review"
NONE = "none"

# Evidence labels (what produced the decision).
JOB_URL = "job_url"
JOB_ID = "job_id"
KNOWN_SENDER = "known_sender"
COMPANY_TITLE = "company_title"
COMPANY_DATE = "company_date"
# Review reasons.
TITLE_ONLY = "title_only"
SEVERAL_ROLES = "several_roles"
SEVERAL_JOBS = "several_jobs"
FUZZY_COMPANY = "fuzzy_company"
COMPANY_ONLY = "company_only"
CONFLICT = "conflicting_evidence"
# A hiring system's own template named the company (and job).
TEMPLATE = "template"
# Set after a scan: an unsaved update whose names point at exactly one saved
# job's company (services/job_links.promote_unsaved).
LIKELY_JOB = "likely_job"
# The user said a guess (or their own link) was the wrong job: never guess
# this email again.
NOT_THIS_JOB = "not_this_job"

_TIER = {JOB_URL: 1, JOB_ID: 1, KNOWN_SENDER: 2, COMPANY_TITLE: 3, COMPANY_DATE: 4}

# Never evidence: articles, joiners and legal suffixes.
_STOP = {
    "the",
    "a",
    "an",
    "and",
    "of",
    "for",
    "at",
    "in",
    "on",
    "to",
    "by",
    "with",
    "inc",
    "incorporated",
    "llc",
    "llp",
    "ltd",
    "limited",
    "co",
    "corp",
    "corporation",
    "company",
    "plc",
    "gmbh",
    "ag",
    "sa",
    "bv",
    "pty",
    "group",
    "holdings",
    "holding",
    "international",
    "global",
    "worldwide",
    "usa",
    "us",
}
# Common English / industry words: they don't identify a company on their own.
_COMMON = {
    "labs",
    "lab",
    "systems",
    "system",
    "solutions",
    "technologies",
    "technology",
    "tech",
    "software",
    "services",
    "service",
    "partners",
    "consulting",
    "digital",
    "health",
    "healthcare",
    "bank",
    "banking",
    "games",
    "insurance",
    "analytics",
    "logistics",
    "media",
    "retail",
    "capital",
    "financial",
    "finance",
    "network",
    "networks",
    "studio",
    "studios",
    "data",
    "cloud",
    "energy",
    "home",
    "depot",
    "first",
    "united",
    "american",
    "national",
    "general",
    "smart",
    "one",
    "new",
    "best",
    "good",
    "great",
    "big",
    "blue",
    "red",
    "green",
    "north",
    "south",
    "east",
    "west",
    "city",
    "state",
    "world",
    "group",
    "team",
    "people",
    "careers",
    "jobs",
    "talent",
    "recruiting",
    "hr",
    "civic",
    "apps",
    "app",
    "web",
    "online",
    "inc",
    "works",
    "industries",
    "foods",
    "food",
    "motors",
    "power",
    "ventures",
    "design",
    "creative",
    "marketing",
    "management",
    "engineering",
    "education",
    "learning",
    "school",
    "university",
    "college",
    "hospital",
    "clinic",
    "medical",
    "pharma",
    "bio",
    "life",
    "care",
    "community",
    "foundation",
    "trust",
    "union",
    "credit",
    "market",
    "markets",
    "store",
    "stores",
    "shop",
}
_WEBMAIL = re.compile(
    r"(?:^|\.)(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|"
    r"aol|proton|protonmail|pm|gmx|zoho|mail)\.",
    re.I,
)
_URL = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
_ID_PARAMS = {
    "jk",
    "gh_jid",
    "jobid",
    "job_id",
    "jid",
    "id",
    "requisitionid",
    "reqid",
    "vjk",
}
_TITLE_SYNONYMS = {"sr": "senior", "jr": "junior", "mgr": "manager", "eng": "engineer"}
# Addresses that write about every role, so they never identify one job.
_SHARED_INBOX = re.compile(
    r"^(?:no-?reply|do-?not-?reply|notifications?|careers?|jobs|talent|"
    r"recruit\w*|hiring|hr|people|team|info|hello|apply|applications?|"
    r"candidates?|staffing|support)[^@]*@",
    re.I,
)
# An email this long before the job was saved is unlikely to be about it.
_DATE_SLACK = timedelta(days=60)


@dataclass
class JobMatch:
    status: str  # matched | review | none
    job: dict | None = None
    evidence: str = ""  # an evidence label or a review reason
    candidates: list[dict] = field(default_factory=list)  # review choices

    @property
    def matched(self) -> bool:
        return self.status == MATCHED


def _tokens(text: str) -> list[str]:
    text = (text or "").lower().replace("&", " and ")
    return [_TITLE_SYNONYMS.get(t, t) for t in re.findall(r"[a-z0-9]+", text)]


def _company_terms(name: str) -> tuple[list[str], list[str], str]:
    """(core words, distinctive words, squashed core) for a company name."""
    core = [t for t in _tokens(name) if t not in _STOP]
    rare = [t for t in core if t not in _COMMON and len(t) >= 3 and not t.isdigit()]
    return core, rare, "".join(core)


def company_initials(name: str) -> str:
    """ "Department of Harbor Services" -> "dhs": the first letters of a
    name of three or more words (joiners and legal suffixes left out), the way
    agencies and large employers sign their mail. Shorter names have none:
    two letters match far too much."""
    core, _, _ = _company_terms(name)
    initials = "".join(t[0] for t in core) if len(core) >= 3 else ""
    return "" if initials in _NOT_INITIALS else initials


# Never a company's initials: domain parts (shop.com.au) and the capitals
# emails use for other things.
_NOT_INITIALS = {
    "com", "org", "net", "gov", "edu", "mil", "int", "www", "eeo", "ada", "pto",
    "faq", "api", "sql", "usa", "ceo", "cto", "cfo", "llc", "inc", "pdf", "ats",
}  # fmt: skip


def _initials_in(initials: str, labels: list[str], upper: set[str]) -> bool:
    """The initials are the sender's domain (dhs.example.gov) or written in
    capitals in the subject or the sender's name ("DHS Recruiting"). Capitals
    in the body never count (job descriptions are full of them), and nor does
    lowercase "dhs" in a sentence."""
    return bool(initials) and (initials in labels or initials.upper() in upper)


def _addresses(*fields: str) -> list[str]:
    return [a.lower() for _, a in getaddresses([f for f in fields if f]) if "@" in a]


def _domain_labels(addresses: list[str]) -> list[str]:
    """Sender-domain labels that can name an employer (no platforms/webmail)."""
    labels: list[str] = []
    for addr in addresses:
        domain = addr.rsplit("@", 1)[-1]
        if is_platform_sender(addr) or _WEBMAIL.search(domain + "."):
            continue
        labels += [re.sub(r"[^a-z0-9]", "", p) for p in domain.split(".")[:-1]]
    return [label for label in labels if label]


def _norm_url(url: str) -> tuple[str, dict[str, str]]:
    parts = urlsplit(url.strip().rstrip(".,;"))
    host = (parts.hostname or "").removeprefix("www.")
    path = parts.path.rstrip("/").lower()
    return f"{host}{path}", {k.lower(): v for k, v in parse_qsl(parts.query)}


def _job_ids(url: str) -> set[str]:
    """Ids a job board puts in a job's URL (query ids, numeric/opaque path tail)."""
    if not url:
        return set()
    base, query = _norm_url(url)
    ids = {v.lower() for k, v in query.items() if k in _ID_PARAMS and len(v) >= 5}
    tail = base.rsplit("/", 1)[-1]
    if len(tail) >= 6 and re.search(r"\d", tail):
        ids.add(tail)
    return ids


@dataclass
class _Haystack:
    words: set[str]
    phrase: str  # " word word … " for whole-phrase search
    urls: set[str]
    raw: str
    # Words written in capitals in the subject and sender name (not the body).
    upper: set[str] = field(default_factory=set)


_UPPER = re.compile(r"\b[A-Z]{3,8}\b")


def _haystack(subject: str, display: str, text: str) -> _Haystack:
    raw = f"{subject}\n{display}\n{text}"
    toks = _tokens(raw)
    return _Haystack(
        words=set(toks),
        phrase=" " + " ".join(toks) + " ",
        urls={_norm_url(u)[0] for u in _URL.findall(raw)},
        raw=raw.lower(),
        upper=set(_UPPER.findall(f"{subject}\n{display}")),
    )


def _has_phrase(h: _Haystack, words: list[str]) -> bool:
    return bool(words) and f" {' '.join(words)} " in h.phrase


_PLATFORM_WORDS = re.compile(
    r"^(?:indeed|linkedin|ziprecruiter|glassdoor|monster|dice|careerbuilder|"
    r"simplyhired|handshake|wellfound|angellist|lensa|jobright|snagajob|"
    r"governmentjobs|usajobs|greenhouse|lever|workday|myworkday|icims|"
    r"smartrecruiters|jobvite|ashby|ashbyhq|workable|bamboohr|taleo)$"
)


def _is_platform_company(job: dict) -> bool:
    """A saved "company" that is really a job site (ZipRecruiter, Indeed…): its
    name is in every email the site sends, so it says nothing about the job."""
    _, _, squashed = _company_terms(job.get("company") or "")
    return bool(squashed) and bool(_PLATFORM_WORDS.match(squashed))


_LEGAL = {
    "inc", "incorporated", "llc", "llp", "ltd", "limited", "co", "corp",
    "corporation", "company", "plc", "gmbh", "ag", "sa", "bv", "pty",
}  # fmt: skip
# Words that put a company name in the context of the reader's application.
_CONTEXT_BEFORE = (
    r"(?:interest in|applying (?:to|with|at)|applied (?:to|with|at)|application "
    r"(?:to|with|at)|position (?:at|with)|role (?:at|with)|opportunity (?:at|with)|"
    r"career (?:at|with)|team at|join|joining|working at|working with|thank you "
    r"from|on behalf of|from the)"
)
_CONTEXT_AFTER = r"(?:team|recruiting|talent|careers?|hiring|hr|people)"


def _name_words(company: str) -> list[str]:
    """The company's whole name as written, minus legal suffixes and a leading
    "the" ("The Copper Kettle Group, Inc." -> copper kettle group)."""
    words = [t for t in _tokens(company) if t not in _LEGAL]
    return words[1:] if words[:1] == ["the"] else words


def _company_named(
    job: dict, subject: str, display: str, text: str, labels: list[str]
) -> bool:
    """Does the email name THIS company, not just one common word of it?

    Yes when the whole name is in the subject or the sender's name, the
    sender's own domain is the company's, the whole name is in the text in an
    application context ("your interest in Acme", "the Acme team"), or a name
    of two or more words appears whole. A one-word name loose in the text
    ("Snap Layouts", "20% off") is not enough.
    """
    core, rare, squashed = _company_terms(job.get("company") or "")
    words = _name_words(job.get("company") or "")
    if not core or not words:
        return False
    for label in labels:
        if label == squashed or (len(squashed) >= 6 and squashed in label):
            return True
        if len(label) >= 5 and label in rare:
            return True
    head = _haystack(subject, display, "")
    if _has_phrase(head, words):
        return True
    if _initials_in(company_initials(job.get("company") or ""), labels, head.upper):
        return True
    name = " ".join(words)
    body = " ".join(_tokens(text))
    if f" {name} " not in f" {body} ":
        return False
    if len(words) >= 2:
        return True
    pattern = (
        rf"\b{_CONTEXT_BEFORE} (?:the )?{re.escape(name)}\b"
        rf"|\b{re.escape(name)} {_CONTEXT_AFTER}\b"
    )
    return bool(re.search(pattern, body))


def _company_hit(job: dict, h: _Haystack, domain_labels: list[str]) -> bool:
    core, rare, squashed = _company_terms(job.get("company") or "")
    if not core:
        return False
    for label in domain_labels:  # careers@quillfeather.example, copperkettle.example
        if label == squashed or (len(label) >= 5 and label in rare):
            return True
        if len(squashed) >= 6 and squashed in label:
            return True
    if _initials_in(company_initials(job.get("company") or ""), domain_labels, h.upper):
        return True
    if rare and all(t in h.words for t in rare):
        return True
    return _has_phrase(h, core)  # all-common names must appear whole


def _company_fuzzy(job: dict, h: _Haystack) -> bool:
    _, rare, _ = _company_terms(job.get("company") or "")
    rare = [t for t in rare if len(t) >= 6]
    if not rare:
        return False
    return all(
        any(fuzz.ratio(t, w) >= 88 for w in h.words if abs(len(w) - len(t)) <= 2)
        for t in rare
    )


def _title_words(job: dict) -> list[str]:
    return [t for t in _tokens(job.get("title") or "") if t not in {"the", "a", "an"}]


def _url_or_id(job: dict, h: _Haystack) -> str:
    url = job.get("apply_url") or ""
    if url:
        base, _ = _norm_url(url)
        if base and "/" in base and base in h.urls:
            return JOB_URL
    ids = _job_ids(url)
    ext = (job.get("external_id") or "").lower()
    if len(ext) >= 6 and re.search(r"\d", ext):
        ids.add(ext)
    for other in job.get("_duplicates", ()):  # the same job saved again
        if other is not job and (label := _url_or_id(other, h)):
            return label
    for jid in ids:
        if re.search(rf"(?<![a-z0-9]){re.escape(jid)}(?![a-z0-9])", h.raw):
            return JOB_ID
    return ""


# "your application for the Sales Engineer position", "interest in the Data
# Analyst role": the specific role an email is about, when it names one.
_ROLE_PHRASE = re.compile(
    r"(?:application|applying|applied|interest|candidacy|interview)\s+(?:for|to|in)\s+"
    r"(?:the\s+|our\s+)?(?:position\s+of\s+|role\s+of\s+)?"
    r"([A-Z][\w/&,.()' -]{2,70}?)"
    r"(?:\s+(?:position|role|opening|job|req\w*)\b|\s+at\b|\s+with\b|[.,;:!\n]|$)"
)
_SAME_ROLE = 80  # token-set similarity at or above which two titles are one role


def _names_other_role(job: dict, subject: str, text: str) -> bool:
    """The email names a specific role, and none of the named roles is this
    job's title — it's about another role at the company, not this job."""
    company = _company_terms(job.get("company") or "")[0]
    roles = [m.group(1).strip() for m in _ROLE_PHRASE.finditer(f"{subject}\n{text}")]
    # "thanks for applying to Acme, Inc." names the company, not a role.
    roles = [r for r in roles if _company_terms(r)[0] != company]
    if not roles:
        return False
    title = (job.get("title") or "").lower()
    return all(fuzz.token_set_ratio(title, r.lower()) < _SAME_ROLE for r in roles)


def _date_ok(job: dict, when: datetime | None) -> bool:
    saved = job.get("saved_at")
    if not when or not saved:
        return True
    if saved.tzinfo is None and when.tzinfo is not None:
        saved = saved.replace(tzinfo=when.tzinfo)
    elif when.tzinfo is None and saved.tzinfo is not None:
        when = when.replace(tzinfo=saved.tzinfo)
    return when >= saved - _DATE_SLACK


def sender_is_saved_company(
    jobs: list[dict], from_addr: str, reply_to: str = ""
) -> bool:
    """True when the sender's own domain names one of the saved companies — a
    job signal even when the text has no job words ("can we move our call?")."""
    labels = _domain_labels(_addresses(from_addr, reply_to))
    empty = _Haystack(set(), " ", set(), "", set())
    return bool(labels) and any(_company_hit(j, empty, labels) for j in jobs)


def _job_key(job: dict) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Company (suffixes and joiners removed) + title words: 'Acme' and
    'Acme, Inc.' with the same title are the same job."""
    core, _, _ = _company_terms(job.get("company") or "")
    return tuple(core), tuple(_title_words(job))


def collapse_duplicates(jobs: list[dict]) -> tuple[list[dict], dict]:
    """One representative per duplicate group — the most recently saved —
    carrying the others in ``_duplicates``; plus a map of every id to its
    representative's id."""
    groups: dict[tuple, list[dict]] = {}
    for j in jobs:
        groups.setdefault(_job_key(j), []).append(j)
    reps: list[dict] = []
    rep_of: dict = {}
    for members in groups.values():
        if len(members) == 1:
            reps.append(members[0])
            rep_of[members[0]["id"]] = members[0]["id"]
            continue
        newest = max(
            members,
            key=lambda j: (j.get("saved_at") is not None, j.get("saved_at") or 0),
        )
        rep = {**newest, "_duplicates": [m for m in members if m is not newest]}
        reps.append(rep)
        for m in members:
            rep_of[m["id"]] = newest["id"]
    return reps, rep_of


DIGEST_MIN_JOBS = 3

# Evidence that ties an email to one saved job by its company (spec 027).
_CLEAR = {JOB_URL, JOB_ID, KNOWN_SENDER, COMPANY_TITLE, COMPANY_DATE}


# Job boards: they send lists of other companies' jobs. Applicant-tracking
# systems (Workday, SmartRecruiters, Jobvite, Paylocity…) send one company's
# own mail and are not boards (spec 027 review).
_BOARD_WORDS = re.compile(
    r"^(?:indeed|indeedemail|linkedin|ziprecruiter|glassdoor|monster|dice|"
    r"careerbuilder|simplyhired|handshake|joinhandshake|wellfound|angellist|"
    r"lensa|jobright|snagajob|governmentjobs|usajobs|jooble|talent|builtin|"
    r"jobleads|learn4good|adzuna|jobcase|ladders|theladders|hired|otta)$"
)


def from_job_board(from_addr: str, reply_to: str = "") -> bool:
    """Sent by a job board (its domain or its name), not by a company or the
    hiring system it uses."""
    name = parseaddr(from_addr or "")[0]
    domains = [a.rsplit("@", 1)[-1] for a in _addresses(from_addr, reply_to)]
    words = set(_tokens(name)) | {p for d in domains for p in d.split(".")}
    return any(_BOARD_WORDS.match(w) for w in words)


def clearly_one_job(match: JobMatch, from_addr: str, reply_to: str = "") -> bool:
    """A clear match to one saved job, from the company rather than a job
    board: such an email is never a job alert, whatever else it names."""
    return (
        match.status == MATCHED
        and match.evidence in _CLEAR
        and not from_job_board(from_addr, reply_to)
    )


# Words that name a place or a kind of business, never one company. A saved
# company made only of these (a city, a state, "Security", "Global Talent
# Group") turns up in addresses and signatures, so it can't tell
# a job alert from a normal email (spec 027).
_GENERIC_NAME = {
    # places
    "america", "american", "national", "international", "global", "north",
    "south", "east", "west", "northwest", "pacific", "city", "county", "state",
    "oregon", "washington", "california", "idaho", "nevada", "arizona", "texas",
    "colorado", "utah", "york", "florida", "portland", "seattle", "vancouver",
    "tacoma", "spokane", "boise", "francisco", "angeles", "diego", "chicago",
    "boston", "houston", "miami", "detroit", "minneapolis", "philadelphia",
    "springfield", "madison", "columbus", "jacksonville",
    "austin", "denver", "phoenix", "atlanta", "dallas", "remote",
    # kinds of business
    "cybersecurity", "security", "health", "healthcare", "medical", "fitness",
    "support", "talent", "link", "consulting", "consultants", "staffing",
    "recruiting", "recruitment", "resources", "services", "service", "public",
    "utilities", "university", "college", "school", "district", "department",
    "administrative", "government", "agency", "bank", "financial", "insurance",
    "construction", "engineering", "manufacturing", "logistics", "energy",
    "digital", "data", "cloud", "network", "networks", "software", "technology",
    "technologies", "tech", "it", "solutions", "systems", "partners", "group",
    "enterprises", "industries", "company", "corporation", "holdings", "core",
}  # fmt: skip


def _digest_company_words(job: dict) -> list[str]:
    _, rare, _ = _company_terms(job.get("company") or "")
    return [t for t in rare if len(t) >= 4 and t not in _GENERIC_NAME]


def _distinct_titles(h: _Haystack, titles: list[list[str]]) -> int:
    """How many different saved titles the email names. The same title named
    again (in the subject and the body, or by several saved jobs) counts once,
    and a title only ever found inside a longer one ("Systems Administrator"
    in "Endpoint Systems Administrator") isn't one of its own."""
    found = {}
    for words in titles:
        needle = f" {' '.join(words)} "
        spans, at = [], h.phrase.find(needle)
        while at >= 0:
            spans.append((at, at + len(needle)))
            at = h.phrase.find(needle, at + 1)
        if spans:
            found[" ".join(words)] = spans
    alone = 0
    for title, spans in found.items():
        inside = [
            (a, b)
            for other, outer in found.items()
            if other != title and len(other) > len(title)
            for a, b in outer
        ]
        if any(not any(a <= s and e <= b for a, b in inside) for s, e in spans):
            alone += 1
    return alone


def looks_like_digest(jobs: list[dict], *, subject: str = "", text: str = "") -> bool:
    """An email naming several different saved titles (across two or more
    companies), or several saved companies by their own distinctive names, is
    a job alert / digest.

    Generic company names never count, and one title counts once however
    often it's named or however many saved jobs share it (spec 027: real
    single-company emails were read as alerts)."""
    reps, _ = collapse_duplicates(jobs)
    h = _haystack(subject, "", text)
    titled = [j for j in reps if _has_phrase(h, _title_words(j))]
    titled_companies = {_job_key(j)[0] for j in titled}
    if (
        len(titled_companies) >= 2
        and _distinct_titles(h, [_title_words(j) for j in titled]) >= DIGEST_MIN_JOBS
    ):
        return True
    named = set()
    for j in reps:
        words = _digest_company_words(j)
        if words and all(w in h.words for w in words):
            named.add(_job_key(j)[0])
    return len(named) >= DIGEST_MIN_JOBS


def match_job(
    jobs: list[dict],
    *,
    subject: str = "",
    from_addr: str = "",
    reply_to: str = "",
    text: str = "",
    date: datetime | None = None,
    known_senders: dict[str, set] | None = None,
) -> JobMatch:
    """Pick the saved job an email is about, or ask for review.

    ``jobs`` are dicts with ``id``, ``company``, ``title`` and optionally
    ``apply_url``, ``external_id``, ``saved_at``. ``known_senders`` maps an
    address to the ids of jobs it already sent updates about. Duplicate saves
    of one job are matched as one (the most recently saved).
    """
    jobs, rep_of = collapse_duplicates(jobs)
    if known_senders:
        known_senders = {
            a: {rep_of.get(j, j) for j in ids} for a, ids in known_senders.items()
        }
    display = parseaddr(from_addr or "")[0]
    h = _haystack(subject, display, text)
    addrs = _addresses(from_addr, reply_to)
    labels = _domain_labels(addrs)

    tiers: dict = {}  # job id -> best tier label

    def offer(job: dict, label: str) -> None:
        cur = tiers.get(job["id"])
        if cur is None or _TIER[label] < _TIER[cur]:
            tiers[job["id"]] = label

    by_id = {j["id"]: j for j in jobs}
    company_jobs = [
        j for j in jobs if not _is_platform_company(j) and _company_hit(j, h, labels)
    ]
    titled = [j for j in jobs if _has_phrase(h, _title_words(j))]
    # A title that is a sub-phrase of another matched title ("Data Engineer" in
    # "Senior Data Engineer") only counts if the longer one isn't there.
    titled = [
        j
        for j in titled
        if not any(
            k is not j
            and len(_title_words(k)) > len(_title_words(j))
            and f" {' '.join(_title_words(j))} " in f" {' '.join(_title_words(k))} "
            for k in titled
        )
    ]

    for j in jobs:
        if label := _url_or_id(j, h):
            offer(j, label)
    known_senders = known_senders or {}
    for addr in addrs:
        # Only a personal address identifies one job: relays, no-reply and shared
        # team inboxes (careers@, talent@…) write about every role.
        if is_platform_sender(addr) or _SHARED_INBOX.match(addr):
            continue
        for jid in known_senders.get(addr, ()):
            if jid in by_id:
                offer(by_id[jid], KNOWN_SENDER)
    for j in company_jobs:
        if j in titled:
            offer(j, COMPANY_TITLE)
    # Without a title, a company only counts when the email really names it
    # (subject, sender, its own domain, or its whole name in context) — not
    # when one of its words ("applied", "support", "portland") turns up.
    named = [
        j for j in company_jobs if _company_named(j, subject, display, text, labels)
    ]
    # Company + date: the user's only saved job at the company — unless the
    # email names a different role there (then it's about a job not saved).
    other_role = (
        len(named) == 1
        and named[0] not in titled
        and _names_other_role(named[0], subject, text)
    )
    if (
        len(named) == 1
        and named[0] not in titled
        and _date_ok(named[0], date)
        and not other_role
    ):
        offer(named[0], COMPANY_DATE)

    if tiers:
        ranked = sorted(tiers.items(), key=lambda kv: _TIER[kv[1]])
        best_id, best = ranked[0]
        # A clear lead means NO other job has strong evidence (URL/ID, known
        # sender, company + title): a link to job A in an email that names job
        # B (a "similar jobs" footer, a recruiter on another role) is review.
        rivals = [jid for jid, lab in ranked[1:] if _TIER[lab] <= _TIER[COMPANY_TITLE]]
        if not rivals:
            return JobMatch(MATCHED, by_id[best_id], best)
        same_tier = all(_TIER[tiers[r]] == _TIER[best] for r in rivals)
        reason = SEVERAL_JOBS if same_tier else CONFLICT
        return JobMatch(
            REVIEW, None, reason, [by_id[best_id], *(by_id[r] for r in rivals)]
        )

    # No automatic match — is there anything worth asking about?
    if len(named) > 1:
        same_company = len({_job_key(j)[0] for j in named}) == 1
        return JobMatch(
            REVIEW, None, SEVERAL_ROLES if same_company else SEVERAL_JOBS, named
        )
    if other_role:  # about another role at the company, which isn't saved
        return JobMatch(NONE)
    if named:  # the one company job, but the email predates it
        return JobMatch(REVIEW, None, COMPANY_ONLY, named)
    if titled:
        return JobMatch(REVIEW, None, TITLE_ONLY, titled)
    fuzzy = [j for j in jobs if _company_fuzzy(j, h)]
    if fuzzy:
        return JobMatch(REVIEW, None, FUZZY_COMPANY, fuzzy)
    return JobMatch(NONE)


# --------------------------------------------------------------------------- #
# Matching the names a hiring system's template states exactly
# --------------------------------------------------------------------------- #
_SAME_TITLE = 85


def _same_company(a: str, b: str) -> bool:
    """'Kestrel Optics' ~ 'Kestrel Optics, Inc.'; 'Harrowgate University' ~
    'Harrowgate University Careers'; never on one common word alone."""
    ca, ra, sa = _company_terms(a)
    cb, rb, sb = _company_terms(b)
    if not ca or not cb:
        return False
    if sa == sb:
        return True
    short, long_ = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
    rare_short = ra if short is ca else rb
    return bool(rare_short) and long_[: len(short)] == short


def _exact_title(title: str) -> list[str]:
    return sorted(re.findall(r"[a-z0-9]+", title.lower()))


def _title_close(a: str, b: str) -> bool:
    return fuzz.token_set_ratio(a.lower(), b.lower()) >= _SAME_TITLE


def match_template(
    jobs: list[dict], tmpl, date: datetime | None = None
) -> JobMatch | None:
    """Match the company / title / job id a template states to a saved job.

    Returns None when the template names nothing usable (the general matcher
    then runs), NONE when it names a company or role that isn't saved.
    """
    jobs, _ = collapse_duplicates(jobs)
    by_id = {j["id"]: j for j in jobs}
    if tmpl.job_id:
        for j in jobs:
            ids = _job_ids(j.get("apply_url") or "") | {
                (j.get("external_id") or "").lower()
            }
            if tmpl.job_id.lower() in {i for i in ids if i}:
                return JobMatch(MATCHED, j, JOB_ID)
    if tmpl.company:
        at = [
            j
            for j in jobs
            if not _is_platform_company(j)
            and _same_company(tmpl.company, j.get("company") or "")
        ]
        if not at:
            return JobMatch(NONE)
        if tmpl.title:
            close = [j for j in at if _title_close(tmpl.title, j.get("title") or "")]
            if len(close) == 1:
                return JobMatch(MATCHED, close[0], TEMPLATE)
            if not close and len(at) == 1:
                return JobMatch(NONE)  # another role at the company, not saved
        elif len(at) == 1:
            return JobMatch(MATCHED, at[0], TEMPLATE)
        # Several roles there and the template didn't say which: the general
        # matcher reads the whole email (the title is usually in the body).
        return None
    if tmpl.title:
        # Exact only: "Engineer I" and "Engineer II" are different jobs.
        want = _exact_title(tmpl.title)
        exact = [j for j in jobs if _exact_title(j.get("title") or "") == want]
        if len(exact) == 1:
            return JobMatch(MATCHED, exact[0], TEMPLATE)
        if exact:
            return JobMatch(REVIEW, None, TITLE_ONLY, exact)
        return JobMatch(NONE)
    del by_id
    return None
