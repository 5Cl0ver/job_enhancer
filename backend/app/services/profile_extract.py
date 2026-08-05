"""Extract application-profile fields from the user's uploaded resume.

Hybrid on purpose:
- Deterministic REGEX for mechanically-reliable fields (phone, LinkedIn/
  GitHub/portfolio URLs) — patterns beat an LLM for these, free and instant.
- The LLM for judgment fields (name, city/state/country), replying strict
  JSON, used only to fill what the heuristics didn't find.

Honesty rule: only returns what the resume actually states. Work
authorization, sponsorship, relocation, salary, notice period are NEVER
guessed — resumes don't contain them.
"""

import json
import logging
import re

from app.services import ai_service

logger = logging.getLogger(__name__)

_PHONE = re.compile(r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
_LINKEDIN = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/[A-Za-z0-9_%/.\-]+", re.I)
_GITHUB = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9_%/.\-]+", re.I)
_URL = re.compile(r"https?://[^\s)>\]]+", re.I)


def _url(u: str) -> str:
    u = u.rstrip(".,;)")
    return u if u.lower().startswith("http") else f"https://{u}"


def extract_contact_heuristics(text: str) -> dict[str, str]:
    """Regex-only pass: the fields a pattern can find reliably."""
    out: dict[str, str] = {}
    if m := _PHONE.search(text):
        out["phone"] = m.group(0).strip()
    if m := _LINKEDIN.search(text):
        out["linkedin_url"] = _url(m.group(0))
    if m := _GITHUB.search(text):
        out["github_url"] = _url(m.group(0))
    for m in _URL.finditer(text):
        u = _url(m.group(0))
        if "linkedin.com" in u.lower() or "github.com" in u.lower():
            continue
        out["portfolio_url"] = u
        break
    return out

# Fields the LLM may contribute (heuristics always win where both found one).
_AI_KEYS = (
    "first_name",
    "last_name",
    "city",
    "state",
    "country",
    "phone",
    "linkedin_url",
    "github_url",
    "portfolio_url",
)

_SYSTEM_PROMPT = """You extract contact details from a resume.
Reply with ONLY a JSON object — no prose, no code fences — using exactly these
keys (value null when the resume does not state it):
{"first_name": null, "last_name": null, "city": null, "state": null,
 "country": null, "phone": null, "linkedin_url": null, "github_url": null,
 "portfolio_url": null}
Never invent values. Use only what is written in the resume."""


async def extract_profile(resume_text: str) -> dict[str, str]:
    """Heuristics first, LLM to fill the gaps. Best-effort: if the LLM is
    down/slow, the regex findings still come back."""
    found = extract_contact_heuristics(resume_text)
    try:
        content, _ms = await ai_service._invoke(_SYSTEM_PROMPT, resume_text[:6000])
        raw = content.strip()
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1]) if start != -1 and end > start else {}
        for key in _AI_KEYS:
            value = data.get(key)
            if key in found or not isinstance(value, str) or not value.strip():
                continue
            value = value.strip()[:100]
            # URLs from the LLM must still look like URLs.
            if key.endswith("_url") and not value.lower().startswith("http"):
                continue
            found[key] = value
    except Exception:  # LLM unavailable — heuristics-only is still useful
        logger.warning("Resume profile AI extraction failed; using heuristics only")
    return found
