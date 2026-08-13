"""Remote MCP server — the "Claude connector".

Lets the user's OWN Claude (a claude.ai custom connector) read their saved jobs
and résumé, and write drafts / statuses back into the app — so they never paste
context into Claude again, and edits flow both ways.

Auth: Supabase is the OAuth 2.1 Authorization Server; this server is the Resource
Server. FastMCP's ``SupabaseProvider`` serves the OAuth *protected-resource*
metadata and validates the Supabase-issued JWT (ES256, same JWKS the REST API
already trusts) on every tool call. We identify the account from the token's
``email`` claim — exactly how ``app/middleware/auth.py`` resolves REST requests —
so "connector login" IS "app login".

Mounting + the OAuth flow are documented in ``docs/mcp-connector.md``.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.auth.providers.supabase import SupabaseProvider
from fastmcp.server.dependencies import get_access_token
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.application_profile import ApplicationProfile
from app.models.custom_answer import CustomAnswer
from app.models.generated_document import GeneratedDocument
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import saved_jobs as sj_svc
from app.services import tracker as tracker_svc


# --------------------------------------------------------------------------- #
# Auth + identity
# --------------------------------------------------------------------------- #
def _build_auth() -> SupabaseProvider | None:
    """Configure Supabase as the OAuth provider. Returns None (connector
    disabled) when MCP_PUBLIC_URL isn't set, so local/dev runs don't require it."""
    if not settings.mcp_public_url:
        return None
    return SupabaseProvider(
        project_url=settings.supabase_url,
        base_url=settings.mcp_public_url,
        algorithm="ES256",
    )


def _claims() -> dict[str, Any]:
    token = get_access_token()
    if token is None:  # FastMCP rejects unauthenticated calls before this, but be safe.
        raise ValueError("Not authenticated")
    return token.claims or {}


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"'{value}' is not a valid job id") from exc


@asynccontextmanager
async def _session_user():
    """Open a DB session and resolve the caller's app User from the JWT email
    claim (the same key the REST API uses). Raises if there's no account."""
    email = _claims().get("email")
    if not email:
        raise ValueError("Your Claude token has no email; can't identify your account.")
    async with AsyncSessionLocal() as db:
        user = await db.scalar(
            select(User).where(User.email == email, User.deleted_at.is_(None))
        )
        if user is None:
            raise ValueError(
                f"No Job Enhancer account found for {email}. Sign in to the app first."
            )
        yield db, user


# --------------------------------------------------------------------------- #
# Serializers — compact, Claude-friendly dicts
# --------------------------------------------------------------------------- #
def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _job_summary(sj: SavedJob, stage_name: str | None) -> dict[str, Any]:
    j = sj.job_listing
    return {
        "job_id": str(sj.id),
        "title": j.title,
        "company": j.company,
        "location": j.location,
        "stage": stage_name,
        "applied_at": _iso(sj.applied_at),
        "emailed_at": _iso(sj.emailed_at),
        "flagged_for_research": sj.flagged_for_research,
    }


def _job_detail(sj: SavedJob, stage_name: str | None) -> dict[str, Any]:
    j = sj.job_listing
    return {
        **_job_summary(sj, stage_name),
        "description": j.description,
        "salary_min": j.salary_min,
        "salary_max": j.salary_max,
        "is_remote": j.is_remote,
        "apply_url": j.apply_url,
        "notes": sj.notes,
        "saved_at": _iso(sj.created_at),
    }


async def _master_profile_text(db, user: User) -> str:
    """The user's application profile + learned answers + active résumé as one
    grounded text block. Claude must tailor ONLY from this — never invent facts."""
    p = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    answers = list(
        await db.scalars(select(CustomAnswer).where(CustomAnswer.user_id == user.id))
    )
    resume_text = await db.scalar(
        select(Resume.extracted_text).where(
            Resume.user_id == user.id, Resume.is_active.is_(True)
        )
    )

    tri = lambda v: "Yes" if v is True else "No" if v is False else None  # noqa: E731
    pairs = [
        (
            "Name",
            " ".join(x for x in [p and p.first_name, p and p.last_name] if x) or None,
        ),
        ("Email", user.email),
        ("Phone", p and p.phone),
        ("Location", ", ".join(x for x in [p and p.city, p and p.state] if x) or None),
        ("LinkedIn", p and p.linkedin_url),
        ("GitHub", p and p.github_url),
        ("Portfolio", p and p.portfolio_url),
        ("Authorized to work", tri(p and p.authorized_to_work)),
        ("Needs visa sponsorship", tri(p and p.requires_sponsorship)),
        ("Willing to relocate", tri(p and p.willing_to_relocate)),
        ("Desired salary (USD/yr)", p and p.desired_salary),
        ("Earliest start / notice", p and p.notice_period),
    ]
    lines = [f"- {k}: {v}" for k, v in pairs if v not in (None, "")]
    if answers:
        lines.append("\nPreviously answered application questions:")
        lines += [f'- "{a.question_text}" -> {a.answer}' for a in answers]
    if resume_text and resume_text.strip():
        lines.append(
            "\nRésumé (source of truth — job titles, employers, dates, "
            "education, skills):"
        )
        lines.append(resume_text.strip())
    return "\n".join(lines) or "(no profile or résumé saved yet)"


# --------------------------------------------------------------------------- #
# The MCP server + tools
# --------------------------------------------------------------------------- #
mcp = FastMCP(
    name="Job Enhancer",
    instructions=(
        "Tools to help the user apply to jobs. When drafting résumés, cover "
        "letters, or outreach emails, ALWAYS call get_master_profile first and "
        "ground everything strictly in it — never invent experience, employers, "
        "dates, or skills the user doesn't have. Never mark a job applied or "
        "emailed unless the user says they did it."
    ),
    auth=_build_auth(),
)


@mcp.tool
async def list_jobs(status: str | None = None, limit: int = 25) -> list[dict]:
    """List the user's saved jobs. Optionally filter by pipeline stage NAME
    (e.g. "Applied", "Interview"). Returns title, company, stage and key dates."""
    async with _session_user() as (db, user):
        stages = {s.id: s.name for s in await tracker_svc.list_stages(db, user.id)}
        jobs = await sj_svc.list_saved_jobs(db, user.id)
        out: list[dict] = []
        for sj in jobs:
            stage_name = stages.get(sj.pipeline_stage_id)
            if status and (stage_name or "").lower() != status.strip().lower():
                continue
            out.append(_job_summary(sj, stage_name))
            if len(out) >= max(1, min(limit, 100)):
                break
        return out


@mcp.tool
async def get_job(job_id: str) -> dict:
    """Full detail for one saved job: description, salary, apply URL, notes,
    stage and dates. Use this to tailor a résumé/email to a specific role."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        stages = {s.id: s.name for s in await tracker_svc.list_stages(db, user.id)}
        return _job_detail(sj, stages.get(sj.pipeline_stage_id))


@mcp.tool
async def get_master_profile() -> str:
    """The user's résumé + application profile as one grounded text block. Call
    this before writing any résumé, cover letter, or outreach email so it's based
    only on the user's real background."""
    async with _session_user() as (db, user):
        return await _master_profile_text(db, user)


@mcp.tool
async def get_pipeline() -> list[dict]:
    """The user's pipeline stages in order, each with how many jobs sit in it —
    a quick read of where everything stands."""
    async with _session_user() as (db, user):
        stages = await tracker_svc.list_stages(db, user.id)
        jobs = await sj_svc.list_saved_jobs(db, user.id)
        counts: dict[Any, int] = {}
        for sj in jobs:
            counts[sj.pipeline_stage_id] = counts.get(sj.pipeline_stage_id, 0) + 1
        return [{"stage": s.name, "jobs": counts.get(s.id, 0)} for s in stages]


@mcp.tool
async def save_draft(job_id: str, document_type: str, content: str) -> dict:
    """Save a document Claude wrote for a saved job so it shows up in the app.
    document_type must be 'resume' or 'cover_letter'. Returns the draft id."""
    if document_type not in ("resume", "cover_letter"):
        raise ValueError("document_type must be 'resume' or 'cover_letter'")
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        doc = GeneratedDocument(
            id=uuid.uuid4(),
            user_id=user.id,
            job_listing_id=sj.job_listing_id,
            document_type=document_type,
            content=content,
            model_used="claude-connector",
        )
        db.add(doc)
        await db.commit()
        return {
            "draft_id": str(doc.id),
            "document_type": document_type,
            "job_id": job_id,
        }


@mcp.tool
async def set_status(job_id: str, stage: str) -> dict:
    """Move a saved job to a pipeline stage BY NAME (e.g. "Applied", "Interview",
    "Rejected"). Only do this when the user confirms the change."""
    async with _session_user() as (db, user):
        stages = await tracker_svc.list_stages(db, user.id)
        match = next(
            (s for s in stages if s.name.lower() == stage.strip().lower()), None
        )
        if match is None:
            names = ", ".join(s.name for s in stages)
            raise ValueError(f"No stage named '{stage}'. Your stages: {names}")
        sj = await tracker_svc.move_job_to_stage(db, _uuid(job_id), match.id, user.id)
        await db.commit()
        return _job_summary(sj, match.name)


@mcp.tool
async def mark_emailed(job_id: str) -> dict:
    """Mark a saved job as 'outreach email sent' (records today). Only when the
    user actually sent it."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        sj.emailed_at = datetime.now(tz=UTC)
        await db.commit()
        stages = {s.id: s.name for s in await tracker_svc.list_stages(db, user.id)}
        return _job_summary(sj, stages.get(sj.pipeline_stage_id))


@mcp.tool
async def flag_for_research(job_id: str, flagged: bool = True) -> dict:
    """Add (or remove) a job from the 'Contact Further' research shortlist."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        sj.flagged_for_research = flagged
        await db.commit()
        stages = {s.id: s.name for s in await tracker_svc.list_stages(db, user.id)}
        return _job_summary(sj, stages.get(sj.pipeline_stage_id))


def build_mcp_app():
    """The MCP ASGI app, or None when the connector is disabled (MCP_PUBLIC_URL
    unset). The MCP endpoint lives at the internal path '/mcp' and the OAuth
    protected-resource metadata at '/.well-known/oauth-protected-resource/mcp'.
    app.main mounts this at ROOT ('/') — after the REST routes, which match
    first — so both land at the origin root exactly where Claude looks for them
    (RFC 9728), while '/v1/*' and '/health' keep working."""
    if not settings.mcp_public_url:
        return None
    return mcp.http_app(path="/mcp")
