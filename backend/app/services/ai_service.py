"""AI service — LangChain NVIDIA NIM integration for document generation.

Model: meta/llama-3.3-70b-instruct via integrate.api.nvidia.com
Free tier: 40 RPM. On 429, raise HTTPException(429) with Retry-After header.
Constitution Principle III requires logging model_used and generation_ms.
"""

import asyncio
import json
import logging
import re
import time

from fastapi import HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_nvidia_ai_endpoints import ChatNVIDIA

from app.config import settings

logger = logging.getLogger(__name__)

_MODEL_ID = settings.nvidia_model
_BASE_URL = "https://integrate.api.nvidia.com/v1"
# Hard cap so a slow/queued model can never hang document generation (and the
# UI waiting on it). Comfortably above a normal generation, well below a hang.
_REQUEST_TIMEOUT_S = 90

_RESUME_SYSTEM_PROMPT = """You are an expert resume writer and career coach.
Your task is to tailor the user's base resume to better match a specific job.
Output ONLY the tailored resume text, preserving professional formatting.
Do not include commentary or explanations — just the resume content."""

_COVER_LETTER_SYSTEM_PROMPT = """You are an expert cover letter writer.
Write a compelling, personalized cover letter for the given role.
Use a professional but engaging tone. Output ONLY the cover letter text.
Do not include commentary or explanations."""


# --- Prompt builders (shared by the NVIDIA path AND the "bring your own Claude"
# bridge, which pastes these into the user's own Claude). One definition, so the
# free model and the user's model are asked for exactly the same thing. --------


def _resume_user_content(
    resume_text: str, job_description: str, job_title: str, company: str
) -> str:
    return f"""JOB TITLE: {job_title}
COMPANY: {company}
JOB DESCRIPTION:
{job_description}

BASE RESUME:
{resume_text}

Please tailor the resume to highlight relevant experience and skills for this role."""


def _cover_letter_user_content(
    resume_text: str, job_description: str, job_title: str, company: str
) -> str:
    return f"""JOB TITLE: {job_title}
COMPANY: {company}
JOB DESCRIPTION:
{job_description}

APPLICANT RESUME:
{resume_text}

Write a tailored cover letter for this position."""


# The fast flow: the user copies our prompt into their Claude, copies the reply,
# and pastes it back into the extension — which renders a formatted PDF. So we
# want the answer RIGHT IN THE CHAT (artifacts are slow to build), cleanly
# Markdown-formatted (our PDF renderer turns ##/-/** into headings/bullets/bold),
# with no commentary or placeholders. Rules go FIRST — leading text carries most weight.
def _bridge_output_rules(doc_label: str) -> str:
    common = f"""IMPORTANT — follow these output rules exactly:
- Write the {doc_label} directly in this chat so I can copy it immediately. Do NOT put it in an artifact, canvas, or downloadable document — that is slower; I just need the text in your reply.
- Output ONLY the {doc_label} itself — no introduction, no commentary, no notes, no questions, and no closing remarks (don't say "here's your resume" or "let me know if…").
- Use ONLY the information provided below. Do NOT invent facts and do NOT insert bracketed placeholders like [X] — if something isn't given, simply leave it out.
"""
    if "resume" in doc_label:
        return (
            common
            + """- Format it as Markdown with this EXACT structure so it renders into a clean PDF:
  # Full Name
  City, ST | phone | email | github/linkedin links   (one line, right under the name)
  ## SUMMARY            (then a short paragraph)
  ## SKILLS             (one line per category: **Category:** comma, separated, list)
  ## WORK EXPERIENCE
  **Company Name** | *Job Title* | Start Date – End Date     (ONE line per role, exactly this order; put the date range LAST)
  - achievement bullet
  - achievement bullet
  ## PROJECTS and ## EDUCATION as needed, same style.
- Use "# " only for the name and "## " for every section heading. Use "- " for bullets and **bold** for the skill category labels.
"""
        )
    return (
        common
        + """- Format it as normal business-letter paragraphs (plain text, blank line between paragraphs). You may start with "# Full Name" and a contact line, then the letter body. Do NOT use section headings or bullet lists.
"""
    )


def build_prompt(
    document_type: str,
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company: str = "",
) -> str:
    """Assemble a single, self-contained prompt the user can paste straight into
    their own Claude (or any chat AI). Combines strict output rules (so the reply
    is one clean, copy-pasteable block) with the instructions + job/resume."""
    if document_type == "resume":
        system, user = (
            _RESUME_SYSTEM_PROMPT,
            _resume_user_content(resume_text, job_description, job_title, company),
        )
        rules = _bridge_output_rules("tailored resume")
    else:
        system, user = (
            _COVER_LETTER_SYSTEM_PROMPT,
            _cover_letter_user_content(
                resume_text, job_description, job_title, company
            ),
        )
        rules = _bridge_output_rules("cover letter")
    return f"{rules}\n{system}\n\n{user}"


def _get_client() -> ChatNVIDIA:
    return ChatNVIDIA(
        model=_MODEL_ID,
        base_url=_BASE_URL,
        api_key=settings.nvidia_api_key,
        temperature=0.7,
        max_tokens=2048,
    )


async def _invoke(system: str, user_content: str) -> tuple[str, int]:
    """Invoke the model and return (content, generation_ms)."""
    client = _get_client()
    messages = [SystemMessage(content=system), HumanMessage(content=user_content)]

    start = time.monotonic()
    try:
        response = await asyncio.wait_for(
            client.ainvoke(messages), timeout=_REQUEST_TIMEOUT_S
        )
    except TimeoutError:
        logger.warning(
            "NVIDIA NIM timed out after %ss (model=%s)", _REQUEST_TIMEOUT_S, _MODEL_ID
        )
        raise HTTPException(
            status_code=503,
            detail="AI generation timed out — the model is busy. Please try again.",
        ) from None
    except Exception as exc:
        exc_str = str(exc).lower()
        if "429" in exc_str or "rate limit" in exc_str:
            logger.warning("NVIDIA NIM rate limit hit: %s", exc)
            raise HTTPException(
                status_code=429,
                detail="AI rate limit reached. Please try again in a minute.",
                headers={"Retry-After": "60"},
            ) from None
        logger.error("NVIDIA NIM error: %s", exc)
        raise HTTPException(
            status_code=503, detail="AI service temporarily unavailable"
        ) from None

    generation_ms = int((time.monotonic() - start) * 1000)
    content = str(response.content) if response.content else ""

    logger.info(
        "Generated document: model=%s ms=%d chars=%d",
        _MODEL_ID,
        generation_ms,
        len(content),
    )
    return content, generation_ms


_AUTOFILL_SYSTEM = """You map a job application form's fields to a user's saved data.

Rules (follow EXACTLY):
- Use ONLY the USER DATA provided. NEVER invent facts. If the data doesn't
  clearly answer a field, OMIT that field entirely.
- For a field with OPTIONS, return the EXACT option text that best fits.
- For a plain text field, return the value as a short string.
- Respond with ONLY a JSON object mapping each field "id" to its value.
  No prose, no markdown, no explanation. Example: {"f0":"Bachelor's","r1":"No"}"""


async def map_fields(user_data: str, fields: list[dict]) -> dict[str, str]:
    """Grounded, schema-constrained field mapping: given the user's data and the
    form fields the deterministic pass couldn't fill, return {field_id: value}
    using ONLY that data. Any failure returns {} (autofill degrades gracefully)."""
    if not fields:
        return {}
    user = (
        f"USER DATA:\n{user_data}\n\n"
        f"FORM FIELDS (JSON):\n{json.dumps(fields, ensure_ascii=False)}\n\n"
        "Return ONLY the JSON object mapping id -> value."
    )
    try:
        content, _ = await _invoke(_AUTOFILL_SYSTEM, user)
    except Exception as exc:  # never let AI mapping break autofill
        logger.warning("autofill map_fields failed: %s", exc)
        return {}

    # Extract the JSON object from the reply (models sometimes wrap it).
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    # Keep only string-ish values, capped, keyed by known field ids.
    ids = {f.get("id") for f in fields}
    out: dict[str, str] = {}
    for k, v in data.items():
        if k in ids and isinstance(v, (str, int, float, bool)) and str(v).strip():
            out[k] = str(v).strip()[:500]
    return out


_WORK_HISTORY_SYSTEM = """You extract EVERY job from a person's resume into structured JSON.

Rules (follow EXACTLY):
- Use ONLY what is written in the RESUME. NEVER invent jobs, employers, or dates.
- Include EVERY distinct job/role you find — do not skip any. Order MOST RECENT first.
- Return a JSON ARRAY. Each element has these keys:
  "title"       job title exactly as written,
  "company"     employer name,
  "location"    the job's "City, State" if the resume gives one for that job or in
                the contact header, else "",
  "start_month" 1-12 or null,   "start_year" 4-digit or null,
  "end_month"   1-12 or null,   "end_year"   4-digit or null,
  "current"     true if the role is ongoing / says "Present" or "Current", else false,
  "description" the role's own bullet points / responsibilities copied VERBATIM
                from the resume (keep the wording; join bullets with newlines).
                Do NOT paraphrase or embellish. "" only if the resume lists none.
- Parse dates like "Oct 2022 - Sep 2024" or "10/2022–Present". If only a year is
  given, fill the year and leave the month null. If a role is current, set
  "current": true and leave end_month/end_year null.
- Respond with ONLY the JSON array. No prose, no markdown, no explanation."""


def _clamp_int(v: object, lo: int, hi: int) -> int | None:
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


async def parse_work_history(resume_text: str) -> list[dict]:
    """Parse a résumé's text into a structured, ordered work-experience list
    (most recent first) so autofill can populate 'Work Experience' sections
    (Workday et al.). Grounded — only what's written; any failure returns []."""
    if not resume_text or not resume_text.strip():
        return []
    user = (
        f"RESUME:\n{resume_text.strip()[:8000]}\n\n"
        "Return ONLY the JSON array of work experience, most recent first."
    )
    try:
        content, _ = await _invoke(_WORK_HISTORY_SYSTEM, user)
    except Exception as exc:  # never let this break autofill
        logger.warning("parse_work_history failed: %s", exc)
        return []

    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except (ValueError, TypeError):
        return []
    if not isinstance(data, list):
        return []

    out: list[dict] = []
    for item in data[:12]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:200]
        company = str(item.get("company") or "").strip()[:200]
        if not title and not company:
            continue
        out.append(
            {
                "title": title,
                "company": company,
                "location": str(item.get("location") or "").strip()[:200],
                "start_month": _clamp_int(item.get("start_month"), 1, 12),
                "start_year": _clamp_int(item.get("start_year"), 1900, 2100),
                "end_month": _clamp_int(item.get("end_month"), 1, 12),
                "end_year": _clamp_int(item.get("end_year"), 1900, 2100),
                "current": bool(item.get("current")),
                "description": str(item.get("description") or "").strip()[:2000],
            }
        )
    return out


async def generate_tailored_resume(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company: str = "",
) -> tuple[str, str, int]:
    """Return (content, model_used, generation_ms)."""
    user_content = _resume_user_content(
        resume_text, job_description, job_title, company
    )
    content, ms = await _invoke(_RESUME_SYSTEM_PROMPT, user_content)
    return content, _MODEL_ID, ms


async def generate_cover_letter(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company: str = "",
) -> tuple[str, str, int]:
    """Return (content, model_used, generation_ms)."""
    user_content = _cover_letter_user_content(
        resume_text, job_description, job_title, company
    )
    content, ms = await _invoke(_COVER_LETTER_SYSTEM_PROMPT, user_content)
    return content, _MODEL_ID, ms
