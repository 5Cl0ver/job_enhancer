"""Header-only "possible job email?" filter — decides which bodies to download.

The inbox is a mixed personal inbox: job mail is a small share of what
arrives. Bodies are only downloaded for emails this filter keeps, so it is
deliberately GENEROUS: it drops only bulk mail (list / no-reply / marketing
headers) that has no job signal at all. Every decision carries a reason so a
scan can count what was filtered out, and the labeling export samples the
dropped emails to measure what the filter misses.

This runs before classification and changes no classification or matching
rule. Pure functions, no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from email.utils import parseaddr

# Header fields fetched in the header-first pass (BODY.PEEK[HEADER.FIELDS ...]).
HEADER_FIELDS = (
    "FROM",
    "REPLY-TO",
    "SUBJECT",
    "DATE",
    "MESSAGE-ID",
    "LIST-ID",
    "LIST-UNSUBSCRIBE",
    "AUTO-SUBMITTED",
    "PRECEDENCE",
)

# Keep reasons
KEEP_PLATFORM = "platform"  # sender is a known hiring platform / ATS / board
KEEP_JOB_WORDS = "job_words"  # subject or sender name has a job word
KEEP_SAVED_COMPANY = "saved_company"  # sender domain looks like a saved company
KEEP_PERSONAL = "personal"  # not bulk mail: a person, or unknown — keep
# Drop reason
DROP_BULK = "bulk_no_job_signal"

_PLATFORM_DOMAINS = re.compile(
    r"(?:^|\.)(?:greenhouse(?:-mail)?\.io|greenhouse\.io|lever\.co|"
    r"myworkday(?:jobs)?\.com|workday\.com|icims\.com|smartrecruiters\.com|"
    r"jobvite\.com|ashbyhq\.com|breezy\.hr|bamboohr\.com|workable(?:mail)?\.com|"
    r"taleo\.net|oraclecloud\.com|successfactors\.(?:com|eu)|"
    r"indeed(?:email)?\.com|linkedin\.com|ziprecruiter\.com|glassdoor\.com|"
    r"wellfound\.com|dice\.com|monster\.com|hired\.com|otta\.com|"
    r"hackerrank\.com|codesignal\.com|codility\.com|testgorilla\.com|"
    r"recruitee\.com|teamtailor\.com|jazzhr\.com|applytojob\.com|"
    r"paylocity\.com|adp\.com|ukg\.com|rippling\.com|gusto\.com)$",
    re.I,
)
# Generous on purpose: a false keep costs one body download; a false drop
# loses a job email.
_JOB_WORDS = re.compile(
    r"\b(?:appl(?:y|ied|ying|ication|icant)s?|interview\w*|position|roles?|"
    r"jobs?|careers?|recruit\w*|talent|hiring|hire[ds]?|candida\w+|offer\w*|"
    r"assessment|assignment|take[- ]home|coding|challenge|screen(?:ing)?|"
    r"opportunit\w+|resume|r[eé]sum[eé]|cv|next steps?|onboarding|employment|"
    r"background check|references?|availability|schedul\w+|reschedul\w+|"
    r"hr|people team|team at|joining|start date|contract)\b",
    re.I,
)
_BULK_LOCAL = re.compile(
    r"^(?:no-?reply|do-?not-?reply|noreply|notifications?|notify|alerts?|"
    r"news(?:letter)?|newsletters|deals|offers|promo(?:tions)?|marketing|"
    r"orders?|receipts?|billing|invoices?|updates?|digest|mailer|bounce|"
    r"info|hello|team|support|reminders?|invites?)(?:[-+_.].*)?$",
    re.I,
)
_GENERIC_DOMAIN_LABELS = {"www", "mail", "email", "e", "em", "news", "info", "mx"}


@dataclass(frozen=True)
class HeaderInfo:
    """The fetched header fields, decoded and cleaned."""

    from_addr: str = ""
    reply_to: str = ""
    subject: str = ""
    date: str = ""
    message_id: str = ""
    list_id: str = ""
    list_unsubscribe: str = ""
    auto_submitted: str = ""
    precedence: str = ""

    @property
    def sender_email(self) -> str:
        return parseaddr(self.from_addr)[1].lower()

    @property
    def sender_name(self) -> str:
        return parseaddr(self.from_addr)[0]

    @property
    def is_bulk(self) -> bool:
        """List, automated or marketing mail (by headers and sender address)."""
        if self.list_id or self.list_unsubscribe:
            return True
        if self.precedence.strip().lower() in {"bulk", "list", "junk"}:
            return True
        auto = self.auto_submitted.strip().lower()
        if auto and auto != "no":
            return True
        local = self.sender_email.split("@", 1)[0]
        return bool(_BULK_LOCAL.match(local))


def is_platform_sender(*addresses: str) -> bool:
    """True when any address is at a known hiring platform / ATS / job board."""
    for addr in addresses:
        email_addr = parseaddr(addr or "")[1].lower()
        if email_addr and _PLATFORM_DOMAINS.search(_domain(email_addr)):
            return True
    return False


def _domain(addr: str) -> str:
    return addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""


def company_tokens(companies: list[str]) -> frozenset[str]:
    """Squashed saved-company names ("Kestrel & Finch" → "kestrelfinch") and
    their distinctive first words, for matching against sender domains."""
    tokens: set[str] = set()
    for name in companies:
        words = re.findall(r"[a-z0-9]+", (name or "").lower())
        words = [w for w in words if w not in {"the", "inc", "llc", "ltd", "co"}]
        if not words:
            continue
        squashed = "".join(words)
        if len(squashed) >= 4:
            tokens.add(squashed)
        if len(words[0]) >= 5:
            tokens.add(words[0])
    return frozenset(tokens)


def _domain_labels(domain: str) -> list[str]:
    parts = [p for p in domain.split(".") if p and p not in _GENERIC_DOMAIN_LABELS]
    return [re.sub(r"[^a-z0-9]", "", p) for p in parts[:-1]]  # drop the TLD


def possible_job_email(
    h: HeaderInfo, saved_companies: frozenset[str] = frozenset()
) -> tuple[bool, str]:
    """(keep?, reason) for one email, from its headers alone."""
    domains = {_domain(h.sender_email), _domain(parseaddr(h.reply_to)[1].lower())}
    domains.discard("")
    if any(_PLATFORM_DOMAINS.search(d) for d in domains):
        return True, KEEP_PLATFORM
    if _JOB_WORDS.search(h.subject) or _JOB_WORDS.search(h.sender_name):
        return True, KEEP_JOB_WORDS
    if saved_companies:
        for d in domains:
            for label in _domain_labels(d):
                if label in saved_companies or any(
                    tok in label for tok in saved_companies if len(tok) >= 6
                ):
                    return True, KEEP_SAVED_COMPANY
    if not h.is_bulk:
        return True, KEEP_PERSONAL
    return False, DROP_BULK
