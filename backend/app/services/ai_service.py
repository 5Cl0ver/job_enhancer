"""AI service — LangChain NVIDIA NIM integration for document generation.

Model: meta/llama-3.3-70b-instruct via integrate.api.nvidia.com
Free tier: 40 RPM. On 429, raise HTTPException(429) with Retry-After header.
Constitution Principle III requires logging model_used and generation_ms.
"""

import asyncio
import logging
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
        return common + """- Format it as Markdown with this EXACT structure so it renders into a clean PDF:
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
    return common + """- Format it as normal business-letter paragraphs (plain text, blank line between paragraphs). You may start with "# Full Name" and a contact line, then the letter body. Do NOT use section headings or bullet lists.
"""


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
        system, user = _RESUME_SYSTEM_PROMPT, _resume_user_content(
            resume_text, job_description, job_title, company
        )
        rules = _bridge_output_rules("tailored resume")
    else:
        system, user = _COVER_LETTER_SYSTEM_PROMPT, _cover_letter_user_content(
            resume_text, job_description, job_title, company
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
    except asyncio.TimeoutError:
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


async def generate_tailored_resume(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company: str = "",
) -> tuple[str, str, int]:
    """Return (content, model_used, generation_ms)."""
    user_content = _resume_user_content(resume_text, job_description, job_title, company)
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
