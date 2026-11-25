"""Problems Claude ran into during an application (spec 030).

Claude reports what went wrong as it happens (a box it couldn't fill, a Job
Catcher error, a lost tab, Job Catcher wrongly saying there's no résumé box)
with the connector's ``report_problem``. They're kept on the run, shown to the
run's owner on the application page and, across every run, to the admin, so
the developer can fix them.

Claude's words are never trusted: capped (20 a run, 500 characters each), the
kind checked against a short list, the page kept without its query or
fragment, and anything that looks like a password, a code or a card number
removed before it's kept.
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
MAX_PROBLEMS = 20
MAX_CHARS = 500
# The admin list looks this far back, at this many runs.
ADMIN_DAYS = 60
ADMIN_RUNS = 300

_REMOVED = "[removed]"
# "password: hunter2", "pin is 1234", "otp=55 12 99"
_SECRET = re.compile(
    r"\b(password|passcode|passwd|pwd|pin|secret|token|api[ _-]?key|otp"
    r"|one[- ]time code|verification code|security answer)"
    r"(\s*(?:is|was|:|=)\s*)(\S+)",
    re.I,
)
# Long random-looking strings (keys, tokens, session ids): letters and digits.
_TOKEN = re.compile(
    r"\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}\b"
)
# Card numbers and US social security numbers.
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


def _now() -> datetime:
    return datetime.now(tz=UTC)


def scrub(text: Any) -> str:
    """One line, capped, with anything secret-looking removed."""
    out = re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_CHARS]
    out = _SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REMOVED}", out)
    out = _TOKEN.sub(_REMOVED, out)
    out = _CARD.sub(_REMOVED, out)
    return _SSN.sub(_REMOVED, out)


def page_of(url: str | None) -> str | None:
    """The page's address without its query or fragment (where tokens live)."""
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return scrub(f"{parts.scheme}://{parts.hostname}{parts.path}")[:300]


def add(
    run: ApplyRun, what: Any, page_url: str | None, kind: str | None
) -> dict[str, Any]:
    """Keep one problem on the run. The same one again counts up instead of
    adding a row; past 20, nothing more is kept."""
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
        same.update(count=int(same.get("count") or 1) + 1, at=at)
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
                "count": 1,
            }
        )
    run.problems = problems
    return {"noted": True}


async def admin_list(db: AsyncSession, limit: int = 100) -> list[dict[str, Any]]:
    """Every run's problems, newest first, for the admin (spec 030)."""
    since = _now() - timedelta(days=ADMIN_DAYS)
    rows = await db.execute(
        select(
            ApplyRun,
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
    for run, email, my_title, my_company, title, company in rows.all():
        if not run.problems:
            continue
        job = " at ".join(x for x in (my_title or title, my_company or company) if x)
        for p in run.problems:
            out.append(
                {
                    **p,
                    "run_id": str(run.id),
                    "status": run.status,
                    "user_email": email,
                    "job": job,
                }
            )
    out.sort(key=lambda p: p.get("at") or "", reverse=True)
    return out[:limit]
