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
from app.schemas.saved_job import ManualJobCreate
from app.services import collections as col_svc
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


async def _rows(db, user: User):
    """The user's pipeline stages and collections, loaded once. Tools that both
    resolve a name and serialize a job need the same rows twice, so they take
    them from here rather than querying per use."""
    return (
        await tracker_svc.list_stages(db, user.id),
        await col_svc.list_collections(db, user.id),
    )


def _maps(stage_rows, col_rows) -> tuple[dict[Any, str], dict[Any, str]]:
    """The two id -> name maps every job summary needs. Built from already-loaded
    rows (not relationships) so the async session never lazy-loads mid-serialization."""
    return (
        {s.id: s.name for s in stage_rows},
        {c.id: c.name for c in col_rows},
    )


def _match_collection(col_rows, name: str):
    """Pick one of the user's collections BY NAME from already-loaded rows.
    Mirrors how set_status resolves a stage: we never create folders on Claude's
    say-so, and an unknown name errors with the real list so Claude can correct
    itself.

    Matching is case-insensitive, but the collections table's uniqueness
    constraint is not — "Dream Jobs" and "dream jobs" can both exist. When a name
    hits more than one, we ask instead of silently filing into whichever sorted
    first."""
    wanted = name.strip().lower()
    hits = [c for c in col_rows if c.name.lower() == wanted]
    if not hits:
        names = ", ".join(c.name for c in col_rows) or "(none yet)"
        raise ValueError(
            f"No collection named '{name}'. Your collections: {names}. "
            "Create it in the app first."
        )
    if len(hits) > 1:
        raise ValueError(
            f"'{name}' matches more than one of your collections "
            f"({', '.join(c.name for c in hits)}). Rename one, or say which you mean."
        )
    return hits[0]


def _job_summary(
    sj: SavedJob, stage_name: str | None, collection_name: str | None
) -> dict[str, Any]:
    j = sj.job_listing
    return {
        "job_id": str(sj.id),
        "title": j.title,
        "company": j.company,
        "location": j.location,
        "stage": stage_name,
        "collection": collection_name,
        "applied_at": _iso(sj.applied_at),
        "emailed_at": _iso(sj.emailed_at),
        "flagged_for_research": sj.flagged_for_research,
    }


def _job_detail(
    sj: SavedJob, stage_name: str | None, collection_name: str | None
) -> dict[str, Any]:
    j = sj.job_listing
    return {
        **_job_summary(sj, stage_name, collection_name),
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
        "Tools to help the user find, save, and apply to jobs. When the user "
        "asks you to save/add/track a job you found on the web, call save_job "
        "with the posting's real title, company, and apply_url, and pass the "
        "posting's own description text VERBATIM — the user reads it in the app "
        "and tailors applications from it, so never summarize, shorten, or "
        "rewrite it. When drafting "
        "résumés, cover letters, or outreach emails, ALWAYS call "
        "get_master_profile first and ground everything strictly in it — never "
        "invent experience, employers, dates, or skills the user doesn't have. "
        "Never mark a job applied or emailed unless the user says they did it. "
        "Collections are the user's folders: call list_collections to see them, "
        "pass `collection` to save_job to file a new job straight into one, and "
        "use move_to_collection for a job that's already saved."
    ),
    auth=_build_auth(),
)


@mcp.tool
async def list_jobs(
    status: str | None = None, collection: str | None = None, limit: int = 25
) -> list[dict]:
    """List the user's saved jobs. Optionally filter by pipeline stage NAME
    (e.g. "Applied", "Interview") and/or by collection NAME — the user's folders
    (e.g. "Claude"). Returns title, company, stage, collection and key dates."""
    async with _session_user() as (db, user):
        stage_rows, col_rows = await _rows(db, user)
        stages, cols = _maps(stage_rows, col_rows)
        col_id = _match_collection(col_rows, collection).id if collection else None
        jobs = await sj_svc.list_saved_jobs(db, user.id, collection_id=col_id)
        out: list[dict] = []
        for sj in jobs:
            stage_name = stages.get(sj.pipeline_stage_id)
            if status and (stage_name or "").lower() != status.strip().lower():
                continue
            out.append(_job_summary(sj, stage_name, cols.get(sj.collection_id)))
            if len(out) >= max(1, min(limit, 100)):
                break
        return out


@mcp.tool
async def list_collections() -> list[dict]:
    """The user's collections (their folders for organizing saved jobs), each
    with how many jobs are filed in it. Call this before save_job or
    move_to_collection so you use a name that actually exists."""
    async with _session_user() as (db, user):
        cols = await col_svc.list_collections(db, user.id)
        jobs = await sj_svc.list_saved_jobs(db, user.id)
        counts: dict[Any, int] = {}
        for sj in jobs:
            counts[sj.collection_id] = counts.get(sj.collection_id, 0) + 1
        return [
            {
                "collection": c.name,
                "jobs": counts.get(c.id, 0),
                "is_default": c.is_default,
            }
            for c in cols
        ]


@mcp.tool
async def save_job(
    title: str,
    company: str,
    apply_url: str,
    location: str = "Not specified",
    description: str | None = None,
    is_remote: bool = False,
    salary_min: int | None = None,
    salary_max: int | None = None,
    salary_period: str | None = None,
    collection: str | None = None,
    notes: str | None = None,
) -> dict:
    """Save a job you found (from its posting URL) into the user's tracker, so it
    shows up in the app ready to apply. Use this when the user asks you to save,
    add, or track a job you located on the web.

    ``apply_url`` must be the http(s) link to the posting. ``description`` must be
    the posting's OWN text, copied verbatim — responsibilities, requirements and
    all. Do NOT summarize, condense, or paraphrase it: the user reads this in the
    app and tailors their résumé and cover letters from it, so a summary silently
    loses the requirements they need. Send the full text when you can see it, and
    leave it empty rather than substituting a description of your own.
    ``salary_period`` is
    'yearly' or 'hourly' when a salary is given. ``collection`` files the job into
    one of the user's folders BY NAME (see list_collections); omit it and the job
    is saved without a folder, exactly as saving from the app does. If the same
    title+company+location is already saved, this returns the existing job instead
    of a duplicate — and still re-files it when a ``collection`` is named. Returns
    the saved job's summary (including its job_id, which other tools like
    get_job / save_draft / set_status take)."""
    period = salary_period if salary_period in ("yearly", "hourly") else None
    async with _session_user() as (db, user):
        stage_rows, col_rows = await _rows(db, user)
        col = _match_collection(col_rows, collection) if collection else None
        data = ManualJobCreate(
            url=apply_url,
            title=title,
            company=company,
            location=location or "Not specified",
            is_remote=is_remote,
            description=description,
            salary_min=salary_min,
            salary_max=salary_max,
            salary_period=period,
            collection_id=col.id if col else None,
            notes=notes,
        )
        sj = await sj_svc.save_manual_job(db, user.id, data)
        # save_manual_job returns an already-saved job untouched, so the folder on
        # ManualJobCreate only lands on a genuinely new row. Naming a collection is
        # an explicit instruction — honor it either way rather than dropping it.
        if col is not None and sj.collection_id != col.id:
            sj.collection_id = col.id
        await db.commit()
        stages, cols = _maps(stage_rows, col_rows)
        return _job_summary(
            sj, stages.get(sj.pipeline_stage_id), cols.get(sj.collection_id)
        )


@mcp.tool
async def get_job(job_id: str) -> dict:
    """Full detail for one saved job: description, salary, apply URL, notes,
    stage and dates. Use this to tailor a résumé/email to a specific role."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        stages, cols = _maps(*await _rows(db, user))
        return _job_detail(
            sj, stages.get(sj.pipeline_stage_id), cols.get(sj.collection_id)
        )


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
        stage_rows, col_rows = await _rows(db, user)
        match = next(
            (s for s in stage_rows if s.name.lower() == stage.strip().lower()), None
        )
        if match is None:
            names = ", ".join(s.name for s in stage_rows)
            raise ValueError(f"No stage named '{stage}'. Your stages: {names}")
        sj = await tracker_svc.move_job_to_stage(db, _uuid(job_id), match.id, user.id)
        await db.commit()
        _, cols = _maps(stage_rows, col_rows)
        return _job_summary(sj, match.name, cols.get(sj.collection_id))


@mcp.tool
async def move_to_collection(job_id: str, collection: str) -> dict:
    """File an already-saved job into one of the user's collections BY NAME —
    their folders in the app (see list_collections). Use this when the user asks
    to move, file, or organize a job they've already saved."""
    async with _session_user() as (db, user):
        stage_rows, col_rows = await _rows(db, user)
        col = _match_collection(col_rows, collection)
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        sj.collection_id = col.id
        await db.commit()
        stages, _ = _maps(stage_rows, col_rows)
        return _job_summary(sj, stages.get(sj.pipeline_stage_id), col.name)


@mcp.tool
async def mark_emailed(job_id: str) -> dict:
    """Mark a saved job as 'outreach email sent' (records today). Only when the
    user actually sent it."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        sj.emailed_at = datetime.now(tz=UTC)
        await db.commit()
        stages, cols = _maps(*await _rows(db, user))
        return _job_summary(
            sj, stages.get(sj.pipeline_stage_id), cols.get(sj.collection_id)
        )


@mcp.tool
async def flag_for_research(job_id: str, flagged: bool = True) -> dict:
    """Add (or remove) a job from the 'Contact Further' research shortlist."""
    async with _session_user() as (db, user):
        sj = await sj_svc.get_saved_job(db, _uuid(job_id), user.id)
        sj.flagged_for_research = flagged
        await db.commit()
        stages, cols = _maps(*await _rows(db, user))
        return _job_summary(
            sj, stages.get(sj.pipeline_stage_id), cols.get(sj.collection_id)
        )


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
