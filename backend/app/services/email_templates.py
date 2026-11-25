"""Exact readers for the templated emails the big hiring systems send.

Most real application updates come from a handful of senders — Indeed,
LinkedIn, ZipRecruiter, Workday, iCIMS, Greenhouse, Lever, Ashby — and each
sends near-identical templates ("An update on your application from Acme",
"Indeed Application: Support Engineer", "Thank you for applying to Acme").
Reading those templates exactly gives the company, the job title and often
the outcome far more reliably than general wording rules. This is what job
trackers that read email lean on most.

Pure functions, no I/O, no AI. :func:`read_template` returns a
:class:`TemplateRead` when the email is one of these templates, else None —
the general classifier and matcher then handle it as before.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from email.utils import parseaddr

# Outcomes a template can state for certain (None = let the classifier decide).
APPLIED = "applied"
REJECTED = "rejected"
INTERVIEW = "interview"
RECRUITER = "recruiter"
IGNORE = "ignore"  # an ad or alert that only looks like an update

_MAX = 160


@dataclass(frozen=True)
class TemplateRead:
    source: str  # indeed | linkedin | ziprecruiter | workday | icims | …
    company: str | None = None
    title: str | None = None
    event: str | None = None  # applied | rejected | interview | recruiter | ignore
    job_id: str | None = None
    # Where the company name came from: the email's own words ("subject") or,
    # failing those, the sender's display name or mailbox ("sender"), which
    # may be a person ("Jo Rivers") or a mailbox ("acmeworkdaynotices").
    company_from: str = "subject"


def _clean(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"\s+", " ", value).strip(" \"'“”‘’.,:;!-–—|")
    if re.search(r"[<>]|https?:|www\.|\S{40}", value):
        return None  # markup or a link read out of an HTML body, not a name
    return value[:_MAX] or None


def _addr(from_addr: str) -> tuple[str, str, str]:
    """(display name, local part, domain) of the sender."""
    name, addr = parseaddr(from_addr or "")
    local, _, domain = addr.lower().partition("@")
    return name.strip().strip("\"'"), local, domain


def _slug_company(local: str) -> str | None:
    """'brightmed+email+x' / 'quillworks+email+y' -> a readable slug,
    only used when nothing better names the company."""
    slug = local.split("+", 1)[0]
    if not slug or slug in {"noreply", "no-reply", "donotreply", "jobs", "careers"}:
        return None
    return slug


_JOB_ID = re.compile(r"\b(?:R|JR|REQ-?|Job ID#? ?)(\d{4,}(?:-\d+)?)\b")
_POSITION_AT = re.compile(
    r"\b(?:applying|applied) (?:to|for) the (?P<title>.+?) (?:position|role|job) at "
    r"(?P<company>.+?)(?:\.|,| has | and |$)",
    re.I,
)
_INTEREST_IN_TITLE = re.compile(
    r"\binterest in (?:the )?(?P<title>[^.]+?)(?: - (?P<id>[A-Z]*\d[\w-]*))? "
    r"(?:position|role)?\s*at (?P<company>[^.]+)",
    re.I,
)


def _indeed(subject: str, name: str, local: str, text: str) -> TemplateRead | None:
    # "Indeed Application: Support Engineer" — the application receipt.
    m = re.match(r"\s*Indeed Application:\s*(.+)$", subject, re.I)
    if m:
        title = _clean(m.group(1))
        company = None
        body = (
            re.search(
                rf"{re.escape(title or '')}\s+(.+?)\s+-\s+[A-Z][\w .]+,\s*[A-Z]{{2}}",
                text,
            )
            if title
            else None
        )
        if body:
            company = _clean(body.group(1))
        return TemplateRead("indeed", company, title, APPLIED)
    # "An update on your application from Acme" — outcome is in the body.
    m = re.match(r"\s*An update on your application from (.+)$", subject, re.I)
    if m:
        company = _clean(m.group(1))
        p = _POSITION_AT.search(text)
        title = _clean(p.group("title")) if p else None
        return TemplateRead("indeed", company, title)
    # "Acme invited you to a video interview" / "You scheduled a … interview with Acme"
    m = re.search(
        r"(?:Good News! |^)(.+?) invited you to (?:a |an )?(?:video |phone )?interview"
        r"|scheduled an? (?:video |phone )?interview with (.+)$"
        r"|interview details from (.+)$",
        subject,
        re.I,
    )
    if m:
        company = _clean(next(g for g in m.groups() if g))
        t = re.search(r"for the (.+?) job\b", text)
        return TemplateRead(
            "indeed", company, _clean(t.group(1)) if t else None, INTERVIEW
        )
    # "You requested new interview times from Acme." — still scheduling.
    m = re.search(r"requested new interview times from (.+?)\.?$", subject, re.I)
    if m:
        return TemplateRead("indeed", _clean(m.group(1)), None, INTERVIEW)
    # "Acme has invited you to apply" — a recruiter reaching out.
    m = re.match(r"\s*(.+?) has invited you to apply", subject, re.I)
    if m:
        return TemplateRead("indeed", _clean(m.group(1)), None, RECRUITER)
    # "Let Acme Staffing know you are interested" — a recruiter's message sent
    # through Indeed; the job details block names the role.
    m = re.match(r"\s*Let (.+?) know you(?:'re| are) interested", subject, re.I)
    if m:
        t = re.search(r"\bJob Title:\s*(.+?)\s+Company:", text)
        return TemplateRead(
            "indeed", _clean(m.group(1)), _clean(t.group(1)) if t else None, RECRUITER
        )
    return None


def _linkedin(subject: str, text: str) -> TemplateRead | None:
    m = re.match(r"\s*(?:\w+, )?your application was sent to (.+)$", subject, re.I)
    if m:
        t = re.search(
            r"Your application was sent to .+? (.+?) " + re.escape(m.group(1).strip()),
            text,
        )
        return TemplateRead(
            "linkedin", _clean(m.group(1)), _clean(t.group(1)) if t else None, APPLIED
        )
    m = re.match(r"\s*Your application to (.+?) at (.+)$", subject, re.I)
    if m:
        # The outcome is in LinkedIn's own template name in the email's links.
        event = REJECTED if "application_rejected" in text else None
        return TemplateRead("linkedin", _clean(m.group(2)), _clean(m.group(1)), event)
    # "Your application was viewed by Acme": still in review, so applied.
    m = re.match(r"\s*Your application was viewed by (.+)$", subject, re.I)
    if m:
        return TemplateRead("linkedin", _clean(m.group(1)), None, APPLIED)
    return None


def _ziprecruiter(subject: str, name: str, text: str) -> TemplateRead | None:
    m = re.match(r'\s*Your "(.+?)" application is complete', subject, re.I)
    if m:
        return TemplateRead("ziprecruiter", None, _clean(m.group(1)), APPLIED)
    if re.search(
        r"\bopening for you\b|\bwants your application\b|would like you to "
        r"complete your application",
        subject,
        re.I,
    ):
        return TemplateRead("ziprecruiter", None, None, IGNORE)
    m = re.match(r"\s*NEW MESSAGE from (.+?) about your application", subject, re.I)
    if m:
        return TemplateRead("ziprecruiter", _clean(m.group(1)))
    return None


_NOT_A_TITLE = re.compile(
    r"\b(?:interview|application|applying|update|thank|invitation|invite|"
    r"reminder|your|you|meeting|call|chat|schedul\w*)\b",
    re.I,
)


def _ats(source: str, subject: str, name: str, local: str, text: str) -> TemplateRead:
    """Workday / iCIMS / Greenhouse / Lever / Ashby / SuccessFactors: the
    employer's own templates, sent through the hiring system. Company comes
    from the subject or sender name; the title from common phrasings."""
    company = None
    title = None
    for pat in (
        r"\bThank you for (?:your interest in|applying (?:to|for|with)) (?:the )?"
        r"(?P<t>.+?) (?:-\s*(?:R|JR|REQ)[\w-]+ )?at (?P<c>[^.!]+)",
        r"\b(?:application|applying) (?:to|with|at) (?P<c>[^.!:|]+)$",
        r"\byour application (?:with|to) (?P<c>[^.!:|]+)$",
        r"^(?P<c>[^|:]+?) \| (?:Update on|Thank you for) your application",
        r"\bUpdate On Your (?P<c>.+?) Application\b",
        # "Update on the Software Engineer I Position at Brambleworks"
        r"^(?:(?:an )?update on (?:the |your )?)?(?P<t>[^|:]+?) "
        r"(?:position|role|opening) at (?P<c>[^.!|]+)$",
        # "AVP, Platform & Data PM At Vellacor"
        r"^(?P<t>[^|:]+?) at (?P<c>[^.!|]+)$",
    ):
        m = re.search(pat, subject, re.I)
        if m:
            company = _clean(m.groupdict().get("c"))
            title = _clean(m.groupdict().get("t")) or title
            if title and _NOT_A_TITLE.search(title):
                title = None  # "Interview scheduled at Acme": a company, no role
            break
    from_subject = bool(company)
    if (
        not company
        and name
        and not re.match(
            r"(?:workday|career development|talent acquisition|system|careers|"
            r"recruiting|hr|notifications?)\b",
            name,
            re.I,
        )
    ):
        company = _clean(
            re.sub(
                r"\s*(?:@ \w+|via \w+|hiring team|recruiting( team)?|"
                r"talent( acquisition)?( team)?|careers?|staffing team|hr)\s*$",
                "",
                name,
                flags=re.I,
            )
        )
    if not title:
        flat = re.sub(r"\s+", " ", text)  # a title can wrap across lines
        m = re.search(
            r"\b(?:for|in) (?:the )?(.+?) \((?:ID|REQ)[^)]*\) position", flat
        ) or re.search(r"\bthe ([^.!?]+?) (?:position|role)\b", flat)
        if m and len(m.group(1)) <= 90:
            title = _clean(m.group(1))
    job = _JOB_ID.search(f"{subject} {text[:400]}")
    return TemplateRead(
        source,
        company or _slug_company(local),
        title,
        None,
        job.group(1) if job else None,
        "subject" if from_subject else "sender",
    )


_ATS_DOMAINS = {
    "myworkday.com": "workday",
    "talent.icims.com": "icims",
    "greenhouse-mail.io": "greenhouse",
    "us.greenhouse-mail.io": "greenhouse",
    "hire.lever.co": "lever",
    "ashbyhq.com": "ashby",
    "successfactors.com": "successfactors",
    "app.jobtoolz.com": "jobtoolz",
    "applytojob.com": "jazzhr",
}


def read_template(subject: str, from_addr: str, text: str) -> TemplateRead | None:
    """The template this email follows, read exactly; None if it isn't one."""
    subject = subject or ""
    text = text or ""
    name, local, domain = _addr(from_addr)
    if domain.endswith("indeed.com"):
        return _indeed(subject, name, local, text)
    if domain.endswith("linkedin.com"):
        return _linkedin(subject, text)
    if domain.endswith("ziprecruiter.com"):
        return _ziprecruiter(subject, name, text)
    for suffix, source in _ATS_DOMAINS.items():
        if domain == suffix or domain.endswith("." + suffix):
            return _ats(source, subject, name, local, text)
    return None
