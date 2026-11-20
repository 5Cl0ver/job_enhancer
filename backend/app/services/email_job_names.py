"""Best-effort company and role names for a job the user hasn't saved.

Pure functions, no I/O. Used for important updates that don't match a saved
job ("Not in your saved jobs") and for recruiter messages, so the Email
Updates page can say "Acme rejected your Support Engineer application."
instead of showing the raw email. Returns None for anything it can't read
with confidence — the page then falls back to a generic sentence.

Company, in order of trust:
1. the subject ("Your application to Acme", "Interview with Acme"),
2. an organisational sender name ("Acme Careers", "Acme Hiring Team"; a
   personal name is never taken for a company),
3. the sender's own domain, unless it's a hiring platform or webmail.

Role: "your application for the Support Engineer position", "Interview: …".
A role must read like a job title: lead-ins such as "the next phase of our
recruitment process for the" are cut, and what still reads like a sentence is
dropped. The person who wrote the email is never taken for the company.
"""

from __future__ import annotations

import re
from email.utils import parseaddr

from app.services.email_classify import company_from_sender
from app.services.email_match import _ROLE_PHRASE
from app.services.email_prefilter import is_platform_sender

_MAX = 120

# Words that mark a sender name as an organisation's mailbox, not a person.
_ORG_WORDS = re.compile(
    r"\b(?:careers?|talent(?: acquisition)?|recruit(?:ing|ment|ers?)?|hiring(?: team)?|"
    r"team|jobs|hr|people(?: team| ops)?|human resources|notifications?|no-?reply|"
    r"applications?|candidates?|staffing)\b",
    re.I,
)
# "Acme via Greenhouse", "Acme @ iCIMS", "Acme | Workday".
_RELAY_TAIL = re.compile(r"\s+(?:via|@|\||-|–|—|from)\s+.*$", re.I)
# A sender name sent "via" / "@" a hiring system is the employer's name.
_VIA_RELAY = re.compile(r"\s(?:via|@)\s", re.I)
_SUBJECT_COMPANY = re.compile(
    r"\b(?i:applying|applied|application|apply|interview(?:ing)?|candidacy|offer|"
    r"update|news|message)\s+(?i:to|at|with|from)\s+"
    r"((?:[A-Z0-9][\w&.'-]*)(?:[ ,]+(?:[A-Z0-9&][\w&.'-]*|of|and|the)){0,5})"
)
_SUBJECT_ROLE = re.compile(
    r"^(?:re:\s*|fw:\s*)*(?:interview|application|assessment|offer)(?: invitation)?"
    r"\s*[:\-–|]\s*(.+)$",
    re.I,
)
_TRAILING_JUNK = re.compile(r"[\s,.:;!|–—-]+$|\b(?:the|and|of)$", re.I)
# Words before the role in a sentence: "the next phase of our recruitment
# process in the Platform Engineer", "the position of Data Analyst".
_ROLE_LEAD_IN = re.compile(
    r"^(?:(?:the|an?|our|your)\s+)?(?:next\s+|final\s+|first\s+)?"
    r"(?:phase|step|stage|round)s?\s+(?:of|in)\s+(?:(?:our|the|your)\s+)?"
    r"(?:recruitment|recruiting|hiring|interview|selection|application)\s+process"
    r"\s+(?:in|for|of|with)\s+(?:the\s+|our\s+)?"
    r"|^(?:the\s+)?(?:position|role)\s+of\s+",
    re.I,
)
# "… role", "… position at Acme": the word ends the title, never inside it
# ("Product Owner Role Based Access" keeps its words).
_ROLE_TAIL = re.compile(
    r"\s+(?:position|role|opening|vacancy)(?:\s+(?:at|with|in|for)\b.*)?$", re.I
)
# A job title doesn't talk to you: these words mean a sentence was caught.
_SENTENCE_WORDS = re.compile(
    r"\b(?:we|you|your|our|please|would|thank|thanks|invite|invited|inviting|"
    r"pleased|excited|regarding|recruitment process|hiring process)\b",
    re.I,
)
_MAX_ROLE_WORDS = 8
# "the next phase of our recruitment process for the Platform Engineer role".
_PROCESS_ROLE = re.compile(
    r"(?:recruitment|recruiting|hiring|interview|selection)\s+process\s+(?:for|in)\s+"
    r"(?:the\s+|our\s+)?([A-Z][\w/&,.()' -]{2,70}?)"
    r"(?:\s+(?:position|role|opening|job)\b|\s+at\b|\s+with\b|[.,;:!\n]|$)"
)
# A personal name: two or three capitalised words ("Nancy Karnas").
_PERSON = re.compile(r"^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}$")


def _tidy(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    for _ in range(3):
        value = _TRAILING_JUNK.sub("", value).strip()
    if len(value) < 2 or not re.search(r"[A-Za-z]", value):
        return None
    if not value[0].isalnum():
        return None  # ".io" left once "Recruiting" is cut from "Recruiting.io"
    return value[:_MAX]


def role_doubtful(title: str | None, *, strict: bool = True) -> bool:
    """True when a job title reads like a piece of a sentence rather than a
    title: its first word is all lower case ("next phase of …"; "iOS" and
    "eCommerce" are fine), or it talks to the reader. ``strict`` also counts
    words, for text read freely out of an email body (a hiring system's own
    title field can be long and still right)."""
    t = (title or "").strip()
    if not t:
        return True
    first = t.split()[0]
    if first[0].isalpha() and first == first.lower():
        return True
    if strict and len(t.split()) > _MAX_ROLE_WORDS:
        return True
    return bool(_SENTENCE_WORDS.search(t))


def clean_role(raw: str | None, *, strict: bool = True) -> str | None:
    """A role read from an email, cut down to the title, or None when what's
    left still isn't one. ``strict=False`` for titles a hiring system filled
    in itself, which only lose a lead-in."""
    role = _tidy(raw)
    if not role:
        return None
    for _ in range(2):
        role = _ROLE_LEAD_IN.sub("", role).strip()
    role = _tidy(_ROLE_TAIL.sub("", role))
    if not role or role_doubtful(role, strict=strict):
        return None
    return role


def is_sender_person(name: str | None, from_addr: str) -> bool:
    """True when ``name`` is the person who sent the email ("Nancy Karnas"
    writing from nancy.karnas@…), not the company they work for. A shape alone
    isn't enough ("Tidelock Systems"): the address must be a person's (first
    name, first.last, flast, …) and not a hiring system's mailbox, where
    "Wells Fargo <wellsfargo@…workday…>" is the employer."""
    name = (name or "").strip()
    if not name or not _PERSON.match(name):
        return False
    display, address = parseaddr(from_addr or "")
    display = display.strip().strip("\"'")
    if not display or display.lower() != name.lower() or _ORG_WORDS.search(display):
        return False
    if is_platform_sender(address):
        return False
    # "Morgan Stanley <morgan@morganstanley.com>": the domain is the name, so
    # it's the company writing.
    squashed = re.sub(r"[^a-z]", "", name.lower())
    domain_label = re.sub(r"[^a-z]", "", company_from_sender(address).lower())
    if domain_label and domain_label == squashed:
        return False
    parts = [p.lower() for p in name.split()]
    first, last = parts[0], parts[-1]
    local = address.split("@")[0].lower()
    # nancy, nancy.karnas, karnas_n, nkarnas, nancyk; not "nancykarnas", which
    # is as likely a company's mailbox as a person's.
    pieces = set(re.split(r"[._+-]+", local))
    return bool(pieces & {first, last}) or local in {
        f"{first[0]}{last}",
        f"{first}{last[0]}",
    }


def _org_display_name(from_addr: str) -> str | None:
    """'Acme Careers' -> 'Acme'; None for personal names like 'Priya Okafor'."""
    name = parseaddr(from_addr or "")[0].strip().strip("\"'")
    if not name or not (_ORG_WORDS.search(name) or _VIA_RELAY.search(name)):
        return None
    name = _RELAY_TAIL.sub("", name)
    name = _ORG_WORDS.sub(" ", name)
    name = re.sub(r"\b(?:the|at|from)\b", " ", name, flags=re.I)
    return _tidy(name)


def _subject_name(subject: str) -> str | None:
    """The name a subject gives after "application to", "interview with"…."""
    m = _SUBJECT_COMPANY.search(subject or "")
    return _tidy(m.group(1)) if m else None


def company_name(subject: str, from_addr: str) -> str | None:
    """The employer an email is from/about, or None."""
    m = _SUBJECT_COMPANY.search(subject or "")
    # "Interview with Nancy Karnas", sent by Nancy: that's the recruiter.
    if m and (name := _tidy(m.group(1))) and not is_sender_person(name, from_addr):
        return name
    if name := _org_display_name(from_addr):
        return name
    label = company_from_sender(from_addr or "")
    return _tidy(label[:1].upper() + label[1:]) if label else None


def role_name(
    subject: str,
    text: str,
    company: str | None = None,
    *,
    not_roles: tuple[str, ...] = (),
) -> str | None:
    """The role an email names ('Support Engineer'), or None. ``not_roles``
    are names known not to be roles (the company, or the sender's own name
    that a subject gave in its place)."""
    avoid = [n.lower() for n in (company, *not_roles) if n]
    m = _SUBJECT_ROLE.search((subject or "").strip())
    candidates = [m.group(1)] if m else []
    candidates += [r.group(1) for r in _ROLE_PHRASE.finditer(f"{subject}\n{text}")]
    candidates += [r.group(1) for r in _PROCESS_ROLE.finditer(f"{subject}\n{text}")]
    for raw in candidates:
        role = clean_role(raw)
        # A "role" that is really "Acme", "Acme for the …" or the person who
        # wrote is no role.
        if role and not any(role.lower().startswith(n) for n in avoid):
            return role
    return None


def job_names(subject: str, from_addr: str, text: str) -> tuple[str | None, str | None]:
    company = company_name(subject, from_addr)
    named = _subject_name(subject)
    return company, role_name(
        subject, text, company, not_roles=(named,) if named else ()
    )
