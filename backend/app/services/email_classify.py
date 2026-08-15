"""Rule-based classification of job-application emails into pipeline signals.

Pure functions (no I/O) so they're fully unit-testable and cheap — the IMAP
fetch layer feeds these, and an optional AI pass can resolve the leftovers later.
The classifier is deliberately conservative: it only fires on strong, common
phrasings so it doesn't mis-move a card. Anything unclear stays ``UNKNOWN`` and
is left for the user (or a later AI pass) to decide.
"""

from __future__ import annotations

import re

from rapidfuzz import fuzz

# Event kinds the classifier can emit.
REJECTED = "rejected"
INTERVIEW = "interview"
APPLIED = "applied"
RECRUITER = "recruiter"
UNKNOWN = "unknown"

# The pipeline stage each signal implies (RECRUITER logs a contact, no move).
STAGE_FOR_EVENT: dict[str, str | None] = {
    REJECTED: "Rejected",
    INTERVIEW: "Interview",
    APPLIED: "Applied",
    RECRUITER: None,
    UNKNOWN: None,
}

_REJECT = re.compile(
    r"\b(unfortunately|regret to inform|not (be )?(moving|proceeding) forward|"
    r"decided (to (move|proceed) (forward |ahead )?with|not to move)|"
    r"other candidates|move forward with other|will not be (moving|proceeding)|"
    r"position (has been|is now) filled|no longer under consideration|"
    r"not (be )?selected|won'?t be (moving|proceeding)|"
    r"not to (proceed|advance)|pursue other candidates)\b",
    re.I,
)
_INTERVIEW = re.compile(
    r"\b(schedule (a |an |your )?(call|interview|chat|conversation|screen)|"
    r"invite you to (an |a )?(interview|conversation)|(would |we'?d )?like to "
    r"(speak|chat|talk|meet|connect)|set up (a )?time|your availability|"
    r"phone screen|book a time|scheduling link|interview with|next steps? in|"
    r"move forward (to|with) (an |a )?interview)\b|calendly\.com|calendar\.app",
    re.I,
)
_APPLIED = re.compile(
    r"\b(application (has been |was )?received|thank you for applying|"
    r"we(?:'ve| have)? received your application|application (was |has been )?"
    r"submitted|thanks for (your interest|applying)|received your application|"
    r"your application (to|for|has been received))\b",
    re.I,
)
# A human-relevant reply (not an automated confirmation).
_JOBBY = re.compile(
    r"\b(role|position|opportunity|your application|resume|cv|recruit|talent|"
    r"hiring|candidacy|the team)\b",
    re.I,
)
_AUTOMATED_SENDER = re.compile(
    r"no-?reply|do-?not-?reply|notifications?@|mailer@", re.I
)


def classify_email(subject: str, body: str, from_addr: str = "") -> str:
    """Classify one email into a pipeline signal. Order matters: a rejection is
    the most important (and most damaging to miss), then an interview invite,
    then a receipt confirmation."""
    text = f"{subject or ''}\n{body or ''}"
    if _REJECT.search(text):
        return REJECTED
    if _INTERVIEW.search(text):
        return INTERVIEW
    if _APPLIED.search(text):
        return APPLIED
    # A real person writing about the role (not a no-reply blast) = a contact
    # worth logging, even if it doesn't map to a stage change.
    if from_addr and not _AUTOMATED_SENDER.search(from_addr) and _JOBBY.search(text):
        return RECRUITER
    return UNKNOWN


def stage_for_event(event: str) -> str | None:
    """The target pipeline stage for a classified event, or None (no move)."""
    return STAGE_FOR_EVENT.get(event)


# --------------------------------------------------------------------------- #
# Matching an email to the saved job it's about
# --------------------------------------------------------------------------- #
# Sender domains that are ATS/board relays, not the employer — useless as a
# company hint (the company lives in the subject/body instead).
_RELAY_DOMAINS = re.compile(
    r"(greenhouse|lever|workday|myworkday|icims|smartrecruiters|jobvite|ashby|"
    r"ashbyhq|breezy|bamboohr|indeed|linkedin|ziprecruiter|glassdoor|hire\.lever|"
    r"us\.greenhouse|gmail|yahoo|outlook|hotmail|proton)\.",
    re.I,
)
# Common two-label public suffixes, so "globex.co.uk" -> "globex" not "co".
_COMPOUND_TLDS = {
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "co.nz",
    "co.jp",
    "com.br",
    "co.in",
    "com.mx",
    "co.za",
    "com.sg",
}


def company_from_sender(from_addr: str) -> str:
    """Best-effort company name from an email address's domain. Returns "" for
    generic relays (ATS/boards/webmail), where the domain says nothing useful."""
    m = re.search(r"@([\w.-]+)", from_addr or "")
    if not m:
        return ""
    domain = m.group(1).lower()
    if _RELAY_DOMAINS.search(domain):
        return ""
    parts = domain.split(".")
    # Drop the TLD — two labels for compound TLDs (co.uk), else one.
    if len(parts) >= 2 and ".".join(parts[-2:]) in _COMPOUND_TLDS:
        parts = parts[:-2]
    else:
        parts = parts[:-1]
    # Drop generic subdomains so the employer label remains.
    parts = [
        p
        for p in parts
        if p not in {"www", "mail", "careers", "jobs", "recruiting", "talent"}
    ]
    return parts[-1] if parts else ""


def match_email_to_job(
    jobs: list[dict],
    *,
    company_hint: str = "",
    subject: str = "",
    min_score: int = 82,
) -> dict | None:
    """Pick the saved job an email is most likely about.

    ``jobs`` are dicts with at least ``company`` and ``title``. We score each on
    a fuzzy match of the company (from the sender domain and/or the subject line)
    and the title (if it shows up in the subject), and return the best job only
    if it clears ``min_score`` — otherwise None, so a low-confidence guess never
    moves the wrong card.
    """
    subj = (subject or "").lower()
    best, best_score = None, 0
    for j in jobs:
        company = (j.get("company") or "").lower()
        title = (j.get("title") or "").lower()
        # Company signal from the sender domain and from the subject text.
        c_sender = (
            fuzz.token_set_ratio(company_hint.lower(), company) if company_hint else 0
        )
        c_subject = fuzz.partial_token_set_ratio(company, subj) if company else 0
        c = max(c_sender, c_subject)
        # Title signal — does the job title appear in the subject?
        t = fuzz.partial_token_set_ratio(title, subj) if title else 0
        # Company is the anchor; the title is a strong tie-breaker/booster.
        score = c if t < 60 else round(0.6 * c + 0.4 * t)
        if t >= 85 and c >= 60:
            score = max(score, round(0.5 * c + 0.5 * t) + 5)
        if score > best_score:
            best, best_score = j, score
    return best if best_score >= min_score else None
