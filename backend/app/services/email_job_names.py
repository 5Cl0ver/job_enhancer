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
"""

from __future__ import annotations

import re
from email.utils import parseaddr

from app.services.email_classify import company_from_sender
from app.services.email_match import _ROLE_PHRASE

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


def _org_display_name(from_addr: str) -> str | None:
    """'Acme Careers' -> 'Acme'; None for personal names like 'Priya Okafor'."""
    name = parseaddr(from_addr or "")[0].strip().strip("\"'")
    if not name or not (_ORG_WORDS.search(name) or _VIA_RELAY.search(name)):
        return None
    name = _RELAY_TAIL.sub("", name)
    name = _ORG_WORDS.sub(" ", name)
    name = re.sub(r"\b(?:the|at|from)\b", " ", name, flags=re.I)
    return _tidy(name)


def company_name(subject: str, from_addr: str) -> str | None:
    """The employer an email is from/about, or None."""
    m = _SUBJECT_COMPANY.search(subject or "")
    if m and (name := _tidy(m.group(1))):
        return name
    if name := _org_display_name(from_addr):
        return name
    label = company_from_sender(from_addr or "")
    return _tidy(label[:1].upper() + label[1:]) if label else None


def role_name(subject: str, text: str, company: str | None = None) -> str | None:
    """The role an email names ('Support Engineer'), or None."""
    m = _SUBJECT_ROLE.search((subject or "").strip())
    candidates = [m.group(1)] if m else []
    candidates += [r.group(1) for r in _ROLE_PHRASE.finditer(f"{subject}\n{text}")]
    for raw in candidates:
        role = _tidy(raw)
        if role and (not company or role.lower() != company.lower()):
            # A "role" that is really "Acme" or "Acme for the …" is no role.
            if company and role.lower().startswith(company.lower()):
                continue
            return role
    return None


def job_names(subject: str, from_addr: str, text: str) -> tuple[str | None, str | None]:
    company = company_name(subject, from_addr)
    return company, role_name(subject, text, company)
