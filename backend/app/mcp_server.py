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

import inspect
import logging
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
from app.models.saved_job import ORIGIN_CLAUDE, SavedJob
from app.models.user import User
from app.schemas.saved_job import ManualJobCreate
from app.services import collections as col_svc
from app.services import onboarding, scout_log
from app.services import saved_jobs as sj_svc
from app.services import scout_runs as scout_svc
from app.services import tracker as tracker_svc

log = logging.getLogger(__name__)


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
        user_id = user.id
        yield db, user
    # The Getting started "Claude" tick (spec 019), once the tool's own session
    # is closed: hourly per account, its own session, never raises.
    await onboarding.touch_claude(AsyncSessionLocal, user_id)


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
        "title": sj.custom_title or j.title,
        "company": sj.custom_company or j.company,
        "location": sj.custom_location or j.location,
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
        "apply_url": sj.custom_apply_url or j.apply_url,
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
        "use move_to_collection for a job that's already saved. "
        "When the user asks for their Job Scout run, call get_scout_brief first "
        "and follow its playbook: the app keeps the memory, takes the exact "
        "posting text from the page itself, and tells you what to do next."
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
        jobs = await sj_svc.list_saved_jobs(
            db, user.id, collection_id=col_id, with_description=False
        )
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
        jobs = await sj_svc.list_saved_jobs(db, user.id, with_description=False)
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
        sj = await sj_svc.save_manual_job(db, user.id, data, origin=ORIGIN_CLAUDE)
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
        user_id = user.id
        text = await _master_profile_text(db, user)
        try:
            async with db.begin_nested():
                await scout_log.record_resume_read(db, user_id)
            await db.commit()
        except Exception:  # noqa: BLE001 — reading the profile matters more
            log.warning("Scout run log: couldn't note the resume read", exc_info=True)
        return text


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


# --------------------------------------------------------------------------- #
# Claude Scout: the app is the memory; every reply stays small (research R8)
# --------------------------------------------------------------------------- #
async def _log(db, user_id, run_id, tool, sent, out=None, error=None) -> None:
    """Write one run-log entry; never lets logging break the tool itself."""
    try:
        async with db.begin_nested():
            await scout_log.record(db, user_id, run_id, tool, sent, out, error)
    except Exception:  # noqa: BLE001 — the tool's answer matters more
        log.warning("Scout run log: couldn't record %s", tool, exc_info=True)


async def _scout(tool: str, run_id, sent: dict, call):
    """Run one Scout tool for the signed-in user and log it on its run (spec
    010): what Claude sent and what the app answered, or why it refused."""
    async with _session_user() as (db, user):
        user_id = user.id  # read now: a rollback expires the user
        try:
            out = await call(db, user)
        except ValueError as e:
            await db.rollback()
            await _log(db, user_id, run_id, tool, sent, error=str(e))
            await db.commit()
            raise
        await _log(db, user_id, run_id or (out or {}).get("run_id"), tool, sent, out)
        await db.commit()
        return out


@mcp.tool
async def get_scout_brief(run_id: str | None = None) -> dict:
    """Start (or carry on with) the user's Job Scout run. Call this FIRST when
    the user says "do my next Job Scout run". Leave run_id empty: the app picks
    the run that's waiting. Returns the short playbook to follow, the resume type
    to look for, a ready-made search URL with the filters already set, and the
    progress so far. If resume_ready, call get_master_profile once and score
    against the resume. An "Anything I'd be good at" search (broad) has no start
    URL yet: choose titles and call set_search_titles. A fresh chat on a
    half-done run carries on where it was."""
    return await _scout(
        "get_scout_brief",
        run_id,
        {"run_id": run_id},
        lambda db, user: scout_svc.brief(db, user.id, run_id),
    )


@mcp.tool
async def check_jobs(
    run_id: str,
    rows: list[dict],
    total_results: int | None = None,
    page_url: str | None = None,
    place_fixed: bool = False,
) -> dict:
    """Which jobs on this results page are new? Send every row of ONE page at
    once (up to 30), each as {"company", "title", "url", "fits"} as shown in
    the list, where "fits" is false when the title alone doesn't fit the resume
    type (the app remembers those, so no later run weighs them again). Returns
    the positions (0-based) worth opening; the rest are already in the user's
    tracker, were seen by an earlier run, hit an excluded word or didn't fit.
    Also returns next_page_url: open it next (the next page of this search, or
    the next search). With the first page of each search, send total_results
    (the result count the page shows) and page_url (the address you landed
    on); on LinkedIn, place_fixed: true after setting the place yourself."""
    sent = {"rows": rows, "total_results": total_results, "page_url": page_url}
    if place_fixed:
        sent["place_fixed"] = True
    return await _scout(
        "check_jobs",
        run_id,
        sent,
        lambda db, user: scout_svc.check_jobs(
            db, user.id, run_id, rows, total_results, page_url, place_fixed
        ),
    )


@mcp.tool
async def set_search_titles(run_id: str, titles: list[str]) -> dict:
    """Send the job titles you chose from the user's resume. On an 'Anything
    I'd be good at' search, up to the brief's max_titles are searched: the app
    adds the user's Always titles first and leaves out Never titles and titles
    resting after finding nothing. When the brief has suggest_titles, send up
    to that many MORE titles at the user's levels, added to the resume type's
    own for this run. Answers with the start_urls to open (filters already
    set) and any titles it left out, with why."""
    return await _scout(
        "set_search_titles",
        run_id,
        {"titles": titles},
        lambda db, user: scout_svc.set_search_titles(db, user.id, run_id, titles),
    )


@mcp.tool
async def report_job(
    run_id: str,
    url: str,
    fit_score: int,
    why_fit: str,
    gaps: str,
    resume_type: str = "",
    title: str = "",
    company: str = "",
    location: str = "",
    level: str = "",
    years_asked: int | None = None,
    posted: str = "",
    in_area: bool | None = None,
) -> dict:
    """Report one job while its posting page is OPEN in the tab. Send the
    posting's link, your 0-10 fit score (the playbook's rubric), why it fits and
    the gaps, each a sentence or two, plus short facts you read on the page:
    title, company, location, level (entry, mid, senior or lead), years_asked
    (the most years of experience it asks for), posted ("2 days ago") and
    in_area (false when the job is outside the brief's area). Do NOT send the
    job text: the app takes the exact posting from the page itself. Answers
    with the outcome (picked = a good fit, kept for the user to confirm; saved;
    below_bar; duplicate; too_far; waiting_for_copy; no_copy; rejected_link),
    the progress, and what to do next. On an "Anything I'd be good at" search,
    also pass resume_type: the name of the user's resume type this job is
    closest to ("" for none)."""
    facts = {
        "title": title,
        "company": company,
        "location": location,
        "level": level,
        "years_asked": years_asked,
        "posted": posted,
        "in_area": in_area,
    }
    sent = {
        "url": url,
        "fit_score": fit_score,
        "why_fit": why_fit,
        "gaps": gaps,
        "resume_type": resume_type,
        **{k: v for k, v in facts.items() if v not in ("", None)},
    }
    return await _scout(
        "report_job",
        run_id,
        sent,
        lambda db, user: scout_svc.report_job(
            db, user.id, run_id, url, fit_score, why_fit, gaps, resume_type, facts
        ),
    )


@mcp.tool
async def check_companies(run_id: str, companies: list[dict]) -> dict:
    """Local companies search only. Which of the businesses a Google search
    listed should you visit? Send every company on the page at once (up to 20),
    each as {"name", "website"}. Returns "visit": the positions (0-based) to
    visit now, with a known careers_url when there is one. The rest were
    checked in the last week, are job boards or directories, or are over this
    run's company limit."""
    return await _scout(
        "check_companies",
        run_id,
        {"companies": companies},
        lambda db, user: scout_svc.check_companies(db, user.id, run_id, companies),
    )


@mcp.tool
async def company_checked(
    run_id: str,
    website: str,
    result: str,
    careers_url: str | None = None,
    name: str = "",
    openings: list[dict] | None = None,
) -> dict:
    """Local companies search only. After looking at a company's site, say
    what it had: result "openings", "none" or "no_careers", with the careers
    page's link when you found one. Send the same website you sent to
    check_companies. With "openings", also send openings: the jobs the careers
    page lists (up to 20), each {"title", "url", "fit"} with fit your 0-10
    score or null when you didn't open it. Report the jobs that fit with
    report_job as usual."""
    sent = {
        "website": website,
        "result": result,
        "careers_url": careers_url,
        "name": name,
    }
    if openings:
        sent["openings"] = openings
    return await _scout(
        "company_checked",
        run_id,
        sent,
        lambda db, user: scout_svc.company_checked(
            db, user.id, run_id, website, result, careers_url, name, openings
        ),
    )


@mcp.tool
async def finish_scout_run(run_id: str, note: str = "") -> dict:
    """End the run: when report_job says done, when results run out, or on a
    CAPTCHA, login wall or error. ``note`` is one line for the user (e.g. "only
    3 new jobs this week")."""
    return await _scout(
        "finish_scout_run",
        run_id,
        {"note": note},
        lambda db, user: scout_svc.finish_run(db, user.id, run_id, note),
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


SCOUT_TOOLS = (
    get_scout_brief,
    set_search_titles,
    check_jobs,
    report_job,
    check_companies,
    company_checked,
    finish_scout_run,
    get_master_profile,
)


def scout_tool_descriptions() -> list[dict]:
    """Each Scout tool's name and description, exactly as Claude sees them."""
    return [
        {"name": t.__name__, "description": inspect.getdoc(t) or ""}
        for t in SCOUT_TOOLS
    ]
