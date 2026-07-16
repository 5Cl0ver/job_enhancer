"""AI service — LangChain NVIDIA NIM integration for document generation.

Model: meta/llama-3.3-70b-instruct via integrate.api.nvidia.com
Free tier: 40 RPM. On 429, raise HTTPException(429) with Retry-After header.
Constitution Principle III requires logging model_used and generation_ms.
"""

import logging
import time

from fastapi import HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_nvidia_ai_endpoints import ChatNVIDIA

from app.config import settings

logger = logging.getLogger(__name__)

_MODEL_ID = "meta/llama-3.3-70b-instruct"
_BASE_URL = "https://integrate.api.nvidia.com/v1"

_RESUME_SYSTEM_PROMPT = """You are an expert resume writer and career coach.
Your task is to tailor the user's base resume to better match a specific job.
Output ONLY the tailored resume text, preserving professional formatting.
Do not include commentary or explanations — just the resume content."""

_COVER_LETTER_SYSTEM_PROMPT = """You are an expert cover letter writer.
Write a compelling, personalized cover letter for the given role.
Use a professional but engaging tone. Output ONLY the cover letter text.
Do not include commentary or explanations."""


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
        response = await client.ainvoke(messages)
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
    user_content = f"""JOB TITLE: {job_title}
COMPANY: {company}
JOB DESCRIPTION:
{job_description}

BASE RESUME:
{resume_text}

Please tailor the resume to highlight relevant experience and skills for this role."""

    content, ms = await _invoke(_RESUME_SYSTEM_PROMPT, user_content)
    return content, _MODEL_ID, ms


async def generate_cover_letter(
    resume_text: str,
    job_description: str,
    job_title: str = "",
    company: str = "",
) -> tuple[str, str, int]:
    """Return (content, model_used, generation_ms)."""
    user_content = f"""JOB TITLE: {job_title}
COMPANY: {company}
JOB DESCRIPTION:
{job_description}

APPLICANT RESUME:
{resume_text}

Write a tailored cover letter for this position."""

    content, ms = await _invoke(_COVER_LETTER_SYSTEM_PROMPT, user_content)
    return content, _MODEL_ID, ms
