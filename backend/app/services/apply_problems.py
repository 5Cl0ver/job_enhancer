"""Bug reports: problems Claude ran into during an application (spec 030).

Claude reports what went wrong as it happens (a box it couldn't fill, a Job
Catcher error, a lost tab, Job Catcher wrongly saying there's no résumé box)
with the connector's ``report_problem``. Each one is kept on the run with its
context (the job, the site, the page, Job Catcher's and the playbook's
versions) and shown to the run's owner on the application page. Each one also
becomes a report in the owner's Bugs & ideas inbox (spec 032,
``services/bug_reports.from_run_problem``), where it's tracked to fixed.

``scrub`` is shared by the inbox, for every source.

Claude's words are never trusted: capped (20 a run, 500 characters each), the
kind checked against a short list, the page kept without its query or
fragment, and anything that looks like a password, a code, an email, a phone
or card number removed before it's kept.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from app.models.apply import ApplyRun

KINDS = ("fill", "job_catcher", "tab", "resume", "site", "other")
MAX_PROBLEMS = 20
MAX_CHARS = 500
# Texts are bounded to twice the cap, plus room for a secret straddling the
# cut, before scrubbing: the patterns stay fast however long the input is.
SCRUB_ROOM = 256

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
# Starts only where a run of address characters starts (no quadratic retries).
_EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(
    # Up to two separators between groups ("555-\n0142": a dash and a break).
    r"(?<![\w/])(?:\+?\d{1,3}[\s.-]{0,2})?\(?\d{3}\)?"
    r"[\s.-]{0,2}\d{3}[\s.-]{0,2}\d{4}(?![\w/])"
)
_CARD = re.compile(r"\b(?:\d[\s-]{0,2}){13,19}\b")
_SSN = re.compile(r"\b\d{3}-\s?\d{2}-\s?\d{4}\b")
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


def _scrub_line(out: str) -> str:
    out = _SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REMOVED}", out)
    out = _PASSWORD_WORD.sub(_password_word, out)
    out = _CODE.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REMOVED}", out)
    out = _EMAIL.sub(_REMOVED, out)
    out = _CARD.sub(_REMOVED, out)
    out = _SSN.sub(_REMOVED, out)
    out = _PHONE.sub(_REMOVED, out)
    return _blobs(out)


def scrub(text: Any, cap: int = MAX_CHARS, lines: bool = False) -> str:
    """Capped, with anything secret-looking removed. One line, or with
    ``lines`` its line breaks kept (at most one blank line in a row), for the
    longer texts of the Bugs & ideas inbox (spec 032)."""
    # Removed first, cut after: a cut never leaves half an email or card.
    # The whole text is scrubbed at once, so a secret split across a line
    # break ("password:\nhunter2") is still caught. Long texts are bounded
    # first, with room past the cap so a secret at the cut is still whole.
    raw = str(text or "")[: cap * 2 + SCRUB_ROOM]
    if lines:
        kept = [re.sub(r"[^\S\n]+", " ", ln).strip() for ln in raw.splitlines()]
        flat = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    else:
        flat = re.sub(r"\s+", " ", raw).strip()
    return _scrub_line(flat)[:cap].strip()


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
    again) instead of adding a row; past 20, nothing more is kept. What was
    kept comes back as ``problem``, for the inbox."""
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
        kept = same
    elif len(problems) >= MAX_PROBLEMS:
        return {"noted": False, "why": f"{MAX_PROBLEMS} problems are already noted."}
    else:
        kept = {
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
        problems.append(kept)
    run.problems = problems
    return {"noted": True, "problem": dict(kept)}
