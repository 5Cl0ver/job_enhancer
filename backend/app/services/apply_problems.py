"""Bug reports: problems Claude ran into during an application (spec 030).

Claude reports what went wrong as it happens (a box it couldn't fill, a Job
Catcher error, a lost tab, Job Catcher wrongly saying there's no résumé box)
with the connector's ``report_problem``. Each one is kept on the run with its
context (the job, the site, the page, Job Catcher's and the playbook's
versions), shown to the run's owner on the application page and, across every
run, to the admin as bug reports to mark fixed or ignored and copy for Claude.

Claude's words are never trusted: capped (20 a run, 500 characters each), the
kind checked against a short list, the page kept without its query or
fragment, and anything that looks like a password, a code, an email, a phone
or card number removed before it's kept.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apply import ApplyRun
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.models.user import User

KINDS = ("fill", "job_catcher", "tab", "resume", "site", "other")
STATUSES = ("open", "fixed", "ignored")
MAX_PROBLEMS = 20
MAX_CHARS = 500
# The admin list looks this far back, at this many runs.
ADMIN_DAYS = 60
ADMIN_RUNS = 300

_REMOVED = "[removed]"
# "password: hunter2", "token = abc", "security answer is Rex"
_SECRET = re.compile(
    r"\b(password|passcode|passwd|pwd|secret|token|api[ _-]?key|security answer)"
    r"(\s*(?:is|was|:|=)\s*)(\S+)",
    re.I,
)
# "password hunter2": the next word, unless it's plain words about the box.
_PASSWORD_WORD = re.compile(r"\b(password|passcode|passwd|pwd)(\s+)(\S+)", re.I)
_PLAIN = set(
    [
        "a",
        "an",
        "and",
        "at",
        "be",
        "box",
        "boxes",
        "check",
        "didn't",
        "couldn't",
        "empty",
        "error",
        "field",
        "fields",
        "for",
        "form",
        "hint",
        "in",
        "input",
        "is",
        "isn't",
        "it",
        "label",
        "manager",
        "missing",
        "not",
        "of",
        "on",
        "or",
        "page",
        "policy",
        "prompt",
        "required",
        "requirements",
        "reset",
        "rules",
        "screen",
        "step",
        "strength",
        "that",
        "the",
        "this",
        "to",
        "too",
        "was",
        "wasn't",
        "with",
        "wrong",
        "again",
        "blank",
        "here",
        "there",
    ]
)
# "code 482913", "OTP: 55 12 99", "verification code was 1234"
_CODE = re.compile(
    r"\b(one[- ]time code|verification code|security code|code|otp|pin|passcode)"
    r"(\s*(?:is|was)?[\s:=#-]*)(\d[\d -]{2,10}\d)\b",
    re.I,
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(
    r"(?<![\w/])(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w/])"
)
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
# Keys and session blobs: 32+ hex, or 32+ base64 with upper, lower and digits.
# No hyphens or underscores, so job slugs ("Senior-Engineer_R0012345") stay.
_HEX = re.compile(r"(?<![\w-])[0-9a-fA-F]{32,}(?![\w-])")
_B64 = re.compile(
    r"(?<![\w-])(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[a-z])(?=[A-Za-z0-9+]*[A-Z])"
    r"[A-Za-z0-9+]{32,}={0,2}(?![\w-])"
)


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _blobs(text: str) -> str:
    return _B64.sub(_REMOVED, _HEX.sub(_REMOVED, text))


def _password_word(m: re.Match) -> str:
    word = m.group(3)
    if word.strip(".,;:!?()\"'").lower() in _PLAIN:
        return m.group(0)
    return f"{m.group(1)}{m.group(2)}{_REMOVED}"


def scrub(text: Any) -> str:
    """One line, capped, with anything secret-looking removed."""
    out = re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_CHARS]
    out = _SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REMOVED}", out)
    out = _PASSWORD_WORD.sub(_password_word, out)
    out = _CODE.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REMOVED}", out)
    out = _EMAIL.sub(_REMOVED, out)
    out = _CARD.sub(_REMOVED, out)
    out = _SSN.sub(_REMOVED, out)
    out = _PHONE.sub(_REMOVED, out)
    return _blobs(out)


def host_of(url: str | None) -> str | None:
    try:
        host = urlsplit((url or "").strip()).hostname
    except ValueError:
        return None
    return host.lower().removeprefix("www.") if host else None


def page_of(url: str | None) -> str | None:
    """The page's address without its query or fragment (where tokens live).
    The path is kept as it is (job slugs and ids), but for long key blobs."""
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return _blobs(f"{parts.scheme}://{parts.hostname}{parts.path}")[:300]


def add(
    run: ApplyRun,
    what: Any,
    page_url: str | None,
    kind: str | None,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Keep one bug report on the run, with its context (job, site, Job
    Catcher and playbook versions). The same one again counts up (and is open
    again) instead of adding a row; past 20, nothing more is kept."""
    text = scrub(what)
    if not text:
        raise ValueError("Say what went wrong, in a line.")
    kind = kind if kind in KINDS else "other"
    page = page_of(page_url)
    at = _now().isoformat()
    problems = [dict(p) for p in run.problems or []]
    same = next(
        (p for p in problems if p.get("what") == text and p.get("kind") == kind),
        None,
    )
    if same is not None:
        same.update(
            count=int(same.get("count") or 1) + 1,
            at=at,
            status="open",
            page=page or same.get("page"),
        )
    elif len(problems) >= MAX_PROBLEMS:
        return {"noted": False, "why": f"{MAX_PROBLEMS} problems are already noted."}
    else:
        problems.append(
            {
                "id": uuid.uuid4().hex[:10],
                "at": at,
                "kind": kind,
                "what": text,
                "page": page,
                "site": host_of(page) or context.get("site"),
                "count": 1,
                "status": "open",
                "run_id": str(run.id),
                "job": context.get("job") or "",
                "job_catcher": context.get("job_catcher"),
                "playbook": run.playbook_version,
            }
        )
    run.problems = problems
    return {"noted": True}


async def set_status(
    db: AsyncSession, run_id: uuid.UUID, problem_id: str, status: str
) -> dict[str, Any]:
    """The admin marks a bug report open, fixed or ignored."""
    if status not in STATUSES:
        raise ValueError("status must be open, fixed or ignored")
    run = await db.scalar(
        select(ApplyRun).where(ApplyRun.id == run_id).with_for_update()
    )
    problems = [dict(p) for p in (run.problems if run else None) or []]
    found = next((p for p in problems if p.get("id") == problem_id), None)
    if found is None:
        raise LookupError("No such bug report.")
    found["status"] = status
    run.problems = problems
    await db.flush()
    return found


async def admin_list(db: AsyncSession, limit: int = 300) -> list[dict[str, Any]]:
    """Every run's bug reports, newest first, for the admin (spec 030). Only
    the columns it needs, never whole runs."""
    since = _now() - timedelta(days=ADMIN_DAYS)
    rows = await db.execute(
        select(
            ApplyRun.id,
            ApplyRun.problems,
            ApplyRun.playbook_version,
            User.email,
            SavedJob.custom_title,
            SavedJob.custom_company,
            JobListing.title,
            JobListing.company,
        )
        .join(User, User.id == ApplyRun.user_id)
        .join(SavedJob, SavedJob.id == ApplyRun.saved_job_id)
        .outerjoin(JobListing, JobListing.id == SavedJob.job_listing_id)
        .where(ApplyRun.created_at >= since)
        .order_by(ApplyRun.last_activity_at.desc())
        .limit(ADMIN_RUNS)
    )
    out: list[dict[str, Any]] = []
    for rid, problems, playbook, email, my_t, my_c, title, company in rows.all():
        if not problems:
            continue
        job = " at ".join(x for x in (my_t or title, my_c or company) if x)
        for p in problems:
            out.append(
                {
                    "status": "open",
                    "job": job,
                    "playbook": playbook,
                    "site": host_of(p.get("page")),
                    "job_catcher": None,
                    **{k: v for k, v in p.items() if v not in (None, "")},
                    "run_id": str(rid),
                    "user_email": email,
                }
            )
    out.sort(key=lambda p: p.get("at") or "", reverse=True)
    return out[:limit]
