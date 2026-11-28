"""CRUD service for SavedJobs."""

import hashlib
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from urllib.parse import (
    parse_qsl,
    quote_plus,
    unquote,
    urlencode,
    urlparse,
    urlsplit,
    urlunsplit,
)

from fastapi import HTTPException
from rapidfuzz import fuzz
from sqlalchemy import String, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, selectinload, with_expression

from app.models.detected_event import DetectedEvent
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.resume import Resume
from app.models.resume_track import ResumeTrack
from app.models.saved_job import (
    ORIGIN_EMAIL,
    ORIGIN_EXTENSION,
    ORIGIN_SEARCH,
    SavedJob,
)
from app.models.scout import SAVED, ScoutFinding
from app.schemas.saved_job import (
    ApplicationSyncItem,
    ApplicationSyncOutcome,
    ApplicationSyncResult,
    AppliedJobCreate,
    ListingRename,
    ManualJobCreate,
    SavedJobCreate,
    SavedJobUpdate,
    ScoutFit,
)
from app.services.dedup import job_content_hash, normalize
from app.services.email_job_names import is_sender_person, role_doubtful
from app.services.scout_dedupe import posting_link
from app.services.scout_tracks import get_track
from app.utils.web_address import public_web_url

# Same thresholds the dedup service uses, so "is this the job I saved?" is judged
# the same way across the app (title ≥88, company ≥85 token_sort_ratio).
_SYNC_TITLE_THRESHOLD = 88
_SYNC_COMPANY_THRESHOLD = 85


# Characters of description a list view gets (the card shows ~3 lines).
DESCRIPTION_PREVIEW_CHARS = 300


def listing_loader(with_description: bool = True):
    """Eager-load a saved job's listing. Without the description, the full text
    never leaves the database: a short preview and a has-description flag are
    computed in SQL instead."""
    loader = selectinload(SavedJob.job_listing)
    if with_description:
        return loader
    return loader.options(
        defer(JobListing.description),
        with_expression(
            JobListing.description_preview,
            func.substr(JobListing.description, 1, DESCRIPTION_PREVIEW_CHARS),
        ),
        with_expression(
            JobListing.has_description,
            func.coalesce(func.length(JobListing.description), 0) > 0,
        ),
    )


async def list_saved_jobs(
    db: AsyncSession,
    user_id: uuid.UUID,
    collection_id: uuid.UUID | None = None,
    pipeline_stage_id: uuid.UUID | None = None,
    is_archived: bool = False,
    *,
    with_description: bool = True,
) -> Sequence[SavedJob]:
    stmt = (
        select(SavedJob)
        .options(listing_loader(with_description))
        .execution_options(populate_existing=not with_description)
        .where(SavedJob.user_id == user_id, SavedJob.is_archived == is_archived)
    )
    if collection_id is not None:
        stmt = stmt.where(SavedJob.collection_id == collection_id)
    if pipeline_stage_id is not None:
        stmt = stmt.where(SavedJob.pipeline_stage_id == pipeline_stage_id)
    stmt = stmt.order_by(SavedJob.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


async def saved_jobs_version(db: AsyncSession, user_id: uuid.UUID) -> str:
    """A short token that changes whenever the user's active saved-job list
    does: one aggregate row, never the list.

    It covers what the slim list shows — which jobs are in it and whether each
    is applied — so it changes on a save, delete, archive or applied toggle
    even when timestamps tie (SQLite stores whole seconds): job count, applied
    count, lowest/highest id, and the latest created/updated times. Listing
    backfills only touch fields the slim list doesn't show."""
    row = (
        await db.execute(
            select(
                func.count(SavedJob.id),
                func.count(SavedJob.applied_at),
                func.min(cast(SavedJob.id, String)),
                func.max(cast(SavedJob.id, String)),
                func.max(SavedJob.updated_at),
                func.max(SavedJob.created_at),
            ).where(SavedJob.user_id == user_id, SavedJob.is_archived.is_(False))
        )
    ).one()
    raw = "|".join(str(v) for v in row)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def list_saved_job_summaries(db: AsyncSession, user_id: uuid.UUID) -> list:
    """Title, company, location, URL and applied date — only those columns."""
    rows = await db.execute(
        select(
            SavedJob.id,
            SavedJob.job_listing_id,
            SavedJob.applied_at,
            JobListing.title,
            JobListing.company,
            JobListing.location,
            JobListing.apply_url,
            SavedJob.resume_id.label("own_resume_id"),
            ResumeTrack.resume_id.label("track_resume_id"),
            SavedJob.resume_usual,
            SavedJob.cover_letter_id,
            SavedJob.custom_apply_url,
        )
        .join(JobListing, SavedJob.job_listing_id == JobListing.id)
        .outerjoin(ResumeTrack, SavedJob.track_id == ResumeTrack.id)
        .where(SavedJob.user_id == user_id, SavedJob.is_archived.is_(False))
        .order_by(SavedJob.created_at.desc())
    )
    return rows.all()


def effective_resume_id(row) -> uuid.UUID | None:
    """A job's résumé: its own, else (unless "usual" was chosen) its type's."""
    if row.own_resume_id:
        return row.own_resume_id
    return None if row.resume_usual else row.track_resume_id


# Job boards and aggregators whose Apply leads elsewhere (spec 040), with
# their country sites (indeed.co.uk, uk.indeed.com, glassdoor.ca…).
_TLD = r"(?:com|net|org|ai|io|jobs|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})"
_JOB_BOARD = re.compile(
    rf"(^|\.)(linkedin\.(?:com|cn)|lnkd\.in|indeed\.{_TLD}|glassdoor\.{_TLD}"
    rf"|ziprecruiter\.{_TLD}|simplyhired\.{_TLD}|monster\.{_TLD}|careerbuilder\.{_TLD}"
    r"|builtin[a-z]*\.com|dice\.com|wellfound\.com|welcometothejungle\.com"
    r"|jobright\.ai|joinhandshake\.com|handshake\.com|usajobs\.gov"
    rf"|jooble\.org|talent\.com|adzuna\.{_TLD}|appcast\.io)$",
    re.IGNORECASE,
)


def _site(url: str | None) -> str:
    try:
        return (urlsplit(url or "").hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


# An application or careers page: never a link from the posting's text (the
# company's home page, a blog post) taken for the Apply.
_APPLICATION = re.compile(
    r"job|career|apply|applicat|recruit|talent|hiring|position|opening|requisition"
    r"|candidate|workday|greenhouse|lever\.co|icims|taleo|dayforce|smartrecruiters"
    r"|ashbyhq|jobvite|workable|successfactors|paylocity|paycom|ultipro|adp\.com",
    re.IGNORECASE,
)


_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)
# A requisition id (R-1234, JR-1234); a repost keeps its suffix (JR12345-1).
_REQ = re.compile(
    r"(?<![a-z0-9])(?:jr|req|r)[-_]?\d{2,}(?:-\d{1,3})?(?![a-z0-9])", re.I
)


# The query parts that name the company on a host many share (Job Catcher's
# siteOf / siteKey), or that the page needs to show the job (SuccessFactors'
# career_ns, Eightfold's domain): kept in a learned link with the posting's.
_KEEP_PARAMS = {
    "company",
    "cid",
    "ccid",
    "clientkey",
    "partnerid",
    "siteid",
    "for",
    "career_ns",
    "domain",
}
# The query parts that name ONE posting anywhere (Job Catcher's postingParam).
_POSTING_PARAMS = {
    "jvi",
    "gh_jid",
    "ashby_jid",
    "jk",
    "vjk",
    "opportunityid",
    "career_job_req_id",
    "job",
    "jobid",
    "job_id",
    "jid",
    "req",
    "reqid",
    "requisitionid",
    "postingid",
    "jobreqid",
    "jobpostingid",
    "positionid",
    "currentjobid",
}
_ONE_DIGITS_OR_UUID = re.compile(
    r"\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)


def _posting_param(host: str, path: str, keys: set[str], name: str, value: str) -> bool:
    """Does this query part name ONE posting here? The ones above anywhere; a
    Greenhouse embed's token, an Eightfold job's pid (never a search with
    query=), an id only as digits or a UUID. Never a session token."""
    key = name.lower()
    if not value:
        return False
    if key in _POSTING_PARAMS:
        return True
    if key == "token":
        return bool(re.search(r"(^|\.)greenhouse\.io$", host)) and bool(
            re.search(r"/embed/job_app\b", path, re.I)
        )
    if key == "pid":
        return bool(re.search(r"(^|\.)eightfold\.ai$", host)) and "query" not in keys
    if key == "id":
        return bool(_ONE_DIGITS_OR_UUID.fullmatch(value))
    return False


# Hosts whose UUIDs name the company (its board), never a posting.
_TENANT_UUIDS = re.compile(
    r"(^|\.)(ultipro\.(com|ca)|rec\.pro\.ukg\.net|paylocity\.com|adp\.com)$", re.I
)
# An applicant system's own posting id in its path.
_OWN_POSTING = (
    (r"(^|\.)greenhouse\.io$", r"/jobs/(\d{4,})"),
    (r"(^|\.)lever\.co$", r"^/[^/]+/([0-9a-f-]{36})"),
    (r"(^|\.)ashbyhq\.com$", r"^/[^/]+/([0-9a-f-]{36})"),
    (r"(^|\.)workable\.com$", r"/j/([0-9a-z]{6,})"),
    (r"(^|\.)jobvite\.com$", r"/job/([0-9a-z]{6,})"),
    (r"(^|\.)smartrecruiters\.com$", r"^/[^/]+/(\d{6,})"),
    (r"(^|\.)icims\.com$", r"/jobs/(\d{3,})/"),
    (r"(^|\.)dayforcehcm\.com$", r"/jobs/(\d{3,})"),
    (r"(^|\.)paylocity\.com$", r"/jobs/(?:details|apply)/(\d{3,})"),
    (r"\.oraclecloud\.com$", r"/job/(\d{3,})"),
    (
        r"(^|\.)ultipro\.(com|ca)$|\.rec\.pro\.ukg\.net$",
        r"/opportunity(?:detail|apply)/([0-9a-f-]{36})",
    ),
)


def posting_level_id(url: str | None) -> str | None:
    """The id that names ONE posting in an address (spec 040), else None: a
    posting query part, a requisition id (R-1234, JR-1234), or the applicant
    system's own posting id in its path. Never a lone UUID where UUIDs name
    the company (UKG, Paylocity, ADP). Learning a job's link needs one."""
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return None
    host = (parts.hostname or "").lower().removeprefix("www.")
    path = unquote(parts.path)
    query = parse_qsl(parts.query)
    keys = {k.lower() for k, _ in query}
    for name, value in query:
        if _posting_param(host, path, keys, name, value):
            key = name.lower()
            return f"{'jk' if key == 'vjk' else key}={value.lower()}"
    req = _REQ.search(path)
    if req:
        return re.sub(r"^([a-z]+)[-_]", r"\1", req.group(0).lower())
    for host_re, path_re in _OWN_POSTING:
        if re.search(host_re, host):
            m = re.search(path_re, path, re.I)
            if m:
                return m.group(1).lower()
    uuid_ = None if _TENANT_UUIDS.search(host) else _UUID.search(path)
    return uuid_.group(0).lower() if uuid_ else None


def clean_link(url: str) -> str:
    """The link to keep: no #part, and only the query parts that name the
    posting or the company on a shared host (a session token like _s.crb or
    a tracking id never stays in it)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    path = unquote(parts.path)
    pairs = parse_qsl(parts.query)
    keys = {k.lower() for k, _ in pairs}
    query = [
        (k, v)
        for k, v in pairs
        if k.lower() in _KEEP_PARAMS or _posting_param(host, path, keys, k, v)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))[
        :2000
    ]


def names_one_posting(url: str | None) -> bool:
    """A posting-level id names one posting (a board or company id never does)."""
    return posting_level_id(url) is not None


# Never the application: sign-ins and file pickers (a résumé from Drive).
_NOT_APPLICATION = re.compile(
    r"(^|\.)(accounts\.google\.com|drive\.google\.com|docs\.google\.com|dropbox\.com"
    r"|onedrive\.live\.com|box\.com|login\.live\.com|microsoftonline\.com|okta\.com"
    r"|auth0\.com)$",
    re.IGNORECASE,
)


def looks_like_application(url: str | None) -> bool:
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return False
    if _NOT_APPLICATION.search(parts.hostname or ""):
        return False
    return bool(_APPLICATION.search(f"{parts.hostname or ''}{parts.path}"))


def on_job_board(url: str | None) -> bool:
    return bool(_JOB_BOARD.search(_site(url)))


async def learn_company_link(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID, url: str
) -> bool:
    """The company's own application for a job on a board (spec 040): the
    page the user said Yes to in Job Catcher ("Is this the application for
    <job>?") after pressing Apply on the job's listing. It must name its
    posting by a posting-level id. It becomes the job's apply link (the
    board's listing stays the listing's own link, as the backup), marked as
    learned: a later Yes may replace it, while a link the user set is never
    changed. True when it was saved."""
    sj = await db.scalar(
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if sj is None or sj.job_listing is None:
        return False
    if sj.custom_apply_url and not sj.apply_url_learned:
        return False  # the user's own link
    listing_url = sj.job_listing.apply_url
    host = _site(url)
    if (
        not public_web_url(url)
        or not names_one_posting(url)
        or not on_job_board(listing_url)
        or on_job_board(url)
        or host == _site(listing_url)
        or not looks_like_application(url)
    ):
        return False
    link = clean_link(url)
    if sj.custom_apply_url == link:
        return False
    sj.custom_apply_url = link
    sj.apply_url_learned = True
    sj.updated_at = datetime.now(UTC)
    await db.flush()
    return True


async def set_job_resume(
    db: AsyncSession,
    user_id: uuid.UUID,
    saved_job_id: uuid.UUID,
    resume_id: uuid.UUID | None,
    usual: bool = False,
) -> SavedJob:
    """The résumé Job Catcher uses for one saved job (spec 020): the user's own
    résumé, or None for the usual one."""
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise HTTPException(status_code=404, detail="Saved job not found")
    if resume_id is not None:
        owned = await db.scalar(
            select(Resume.id).where(Resume.id == resume_id, Resume.user_id == user_id)
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="Résumé not found")
    sj.resume_id = resume_id
    sj.resume_usual = bool(usual and resume_id is None)
    sj.updated_at = datetime.now(UTC)
    await db.flush()
    return sj


async def get_saved_job(
    db: AsyncSession,
    saved_job_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    with_description: bool = True,
) -> SavedJob:
    sj = await db.scalar(
        select(SavedJob)
        .options(listing_loader(with_description))
        .execution_options(populate_existing=not with_description)
        .where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if not sj:
        raise HTTPException(status_code=404, detail="Saved job not found")
    return sj


# A listing with less than this much description text is "thin" — the extension
# should send full details when it can see them (passive backfill).
MIN_DESCRIPTION_CHARS = 200


async def get_saved_listing(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    company: str = "",
    location: str = "",
    url: str = "",
) -> JobListing | None:
    """The listing for this job IF this user has saved it, else None. Matches by
    the same content hash used for dedup, so the extension can show "already
    saved" (and whether details are still missing) before a click.

    When the hash misses and the page's ``url`` is given, the user's saved job
    with that posting link counts too: a job saved before its page was read
    (Scout's "Save anyway", spec 015) carries the location Claude read, which
    rarely matches the page's wording. A link alone is never enough: the
    saved job must also have (nearly) the same title and company, because a
    search page's link can stand for many jobs."""
    listing, _ = await _find_saved_listing(db, user_id, title, company, location, url)
    return listing


async def _find_saved_listing(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    company: str,
    location: str,
    url: str,
) -> tuple[JobListing | None, bool]:
    """``get_saved_listing`` plus whether it was found by its link only."""
    content_hash = job_content_hash(
        normalize(title), normalize(company), normalize(location)
    )
    listing = await db.scalar(
        select(JobListing).where(JobListing.content_hash == content_hash)
    )
    if listing is not None and is_mail_link(listing.apply_url):
        # Maybe someone else's email-made job: this user's own copy has its own hash.
        own = await db.scalar(
            select(JobListing).where(
                JobListing.content_hash
                == _own_hash(
                    normalize(title), normalize(company), normalize(location), user_id
                )
            )
        )
        if own is not None:
            listing = own
    if listing is not None:
        saved_id = await db.scalar(
            select(SavedJob.id).where(
                SavedJob.user_id == user_id, SavedJob.job_listing_id == listing.id
            )
        )
        if saved_id is not None:
            return listing, False
    links = _link_forms(url)
    if not links or not normalize(title) or not normalize(company):
        return None, False
    candidates = await db.scalars(
        select(JobListing)
        .join(SavedJob, SavedJob.job_listing_id == JobListing.id)
        .where(SavedJob.user_id == user_id, JobListing.apply_url.in_(links))
        .order_by(SavedJob.created_at.desc(), JobListing.id)
    )
    for cand in candidates:
        if _same_job(cand, title, company):
            return cand, True
    return None, False


def _same_job(listing: JobListing, title: str, company: str) -> bool:
    """The same title and company, judged like dedup (wording may differ a
    little: "IT Support Tech" vs "IT Support Technician")."""
    cand_title = listing.title_normalized or normalize(listing.title)
    cand_company = listing.company_normalized or normalize(listing.company)
    return (
        fuzz.token_sort_ratio(normalize(title), cand_title) >= _SYNC_TITLE_THRESHOLD
        and fuzz.token_sort_ratio(normalize(company), cand_company)
        >= _SYNC_COMPANY_THRESHOLD
    )


# Links into someone's mailbox (an email-made job's "posting" link carries the
# email's subject and sender). A listing with one is never shared with another
# user (see save_manual_job).
_MAIL_HOSTS = frozenset(
    {
        "mail.google.com",
        "mail.yahoo.com",
        "mail.aol.com",
        "outlook.live.com",
        "outlook.office.com",
        "outlook.office365.com",
        "mail.proton.me",
    }
)


def is_mail_link(url: str | None) -> bool:
    try:
        return (urlparse(url or "").hostname or "").lower() in _MAIL_HOSTS
    except ValueError:
        return False


async def _held_by_others(
    db: AsyncSession, listing_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """Has any other user saved this (shared) listing?"""
    return bool(
        await db.scalar(
            select(func.count())
            .select_from(SavedJob)
            .where(
                SavedJob.job_listing_id == listing_id,
                SavedJob.user_id != user_id,
            )
        )
    )


def _link_forms(url: str) -> list[str]:
    """The ways a posting link may have been stored: as given, with and without
    a trailing slash, and as its standalone job page (LinkedIn/Indeed panes)."""
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return []
    forms = set()
    for u in (url, posting_link(url)):
        bare = u.rstrip("/")
        forms |= {bare, bare + "/"}
    return sorted(forms)


async def _private_to_another(
    db: AsyncSession, listing: JobListing, user_id: uuid.UUID
) -> bool:
    """A listing whose link is someone else's mailbox (email-made), that this
    user hasn't saved. Private even when its maker has since deleted the job:
    the link still carries their email's subject and sender."""
    if not is_mail_link(listing.apply_url):
        return False
    mine = await db.scalar(
        select(SavedJob.id).where(
            SavedJob.user_id == user_id, SavedJob.job_listing_id == listing.id
        )
    )
    return mine is None


def _own_hash(title_norm: str, company_norm: str, location_norm: str, user_id) -> str:
    """The content hash of this user's own copy of a job whose shared listing
    is someone else's email-made one (see save_manual_job)."""
    return job_content_hash(title_norm, company_norm, f"{location_norm}|own:{user_id}")


def listing_needs_details(listing: JobListing) -> bool:
    """Thin description OR no salary — either way, invite the extension to send
    full details next time the user is on the job's page."""
    thin_description = len(listing.description or "") < MIN_DESCRIPTION_CHARS
    no_salary = listing.salary_min is None and listing.salary_max is None
    return thin_description or no_salary


async def backfill_job_details(
    db: AsyncSession, user_id: uuid.UUID, data: ManualJobCreate
) -> list[str]:
    """Upgrade a saved job's listing with richer details captured later.

    Passive backfill: the user saved a job from a feed (thin — title only),
    and later opened the actual job page, where the extension can capture the
    full description/salary. Only jobs the USER has saved can be backfilled,
    and fields are only ever upgraded (longer description, filling empty
    salary/job_type) — never downgraded. Returns the list of updated fields.
    """
    listing, by_link = await _find_saved_listing(
        db, user_id, data.title, data.company, data.location, data.url
    )
    if listing is None:
        return []
    # job_listings is a shared pool. A row another user also saved changes only
    # when it is a job board's listing matched exactly, and then only by
    # upgrading its public posting (description, pay, type) — never a typed-in
    # (manual) row, a link-only match, or its location / remote-ness.
    shared = await _held_by_others(db, listing.id, user_id)
    if shared and (by_link or listing.source == "manual"):
        return []

    updated: list[str] = []
    # Saved before its page was read: take the page's real location.
    if (
        not shared
        and listing.location in (None, "", "Not specified")
        and data.location
        and data.location != "Not specified"
    ):
        listing.location = data.location
        updated.append("location")
    # A longer description is a fuller one (feed snippet -> real posting).
    if data.description and len(data.description) > len(listing.description or ""):
        listing.description = data.description
        updated.append("description")
    if data.salary_min and not listing.salary_min:
        listing.salary_min = data.salary_min
        updated.append("salary_min")
    if data.salary_max and not listing.salary_max:
        listing.salary_max = data.salary_max
        updated.append("salary_max")
    if (
        data.salary_period
        and not listing.salary_period
        and ("salary_min" in updated or "salary_max" in updated)
    ):
        listing.salary_period = data.salary_period
        updated.append("salary_period")
    if data.job_type and not listing.job_type:
        listing.job_type = data.job_type
        updated.append("job_type")
    # is_remote is CORRECTED, not just filled: early captures falsely flagged
    # on-site jobs as Remote (full-page text scan); the capture sent from the
    # job's own page is the trustworthy signal.
    # (Not on a link-only match: the page may still be drawing the job.)
    if not by_link and not shared and data.is_remote != listing.is_remote:
        listing.is_remote = data.is_remote
        updated.append("is_remote")

    if updated:
        await db.flush()
    return updated


# Webmail sites: only "Add to My Jobs" on an email update gives a job such a link.
MAIL_HOSTS = ("mail.yahoo.com", "mail.aol.com", "mail.google.com")


def listing_origin(listing: JobListing | None) -> str | None:
    """What a listing itself says about where a job came from, for a save that
    names only the listing (the app's Save button): a job-board feed's listing
    is a search result; one whose link is the user's webmail was made from an
    email. A person-made listing otherwise doesn't say, so: unknown."""
    if listing is None:
        return None
    if listing.source != "manual":
        return ORIGIN_SEARCH
    host = (urlparse(listing.apply_url or "").hostname or "").lower()
    return ORIGIN_EMAIL if host in MAIL_HOSTS else None


async def save_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: SavedJobCreate,
    *,
    origin: str | None = None,
) -> SavedJob:
    sj = SavedJob(id=uuid.uuid4(), user_id=user_id, origin=origin, **data.model_dump())
    db.add(sj)
    try:
        await db.flush()
    except IntegrityError as e:
        # Only a real duplicate (the user↔listing unique constraint) is a 409.
        # Any other integrity error is a genuine bug — don't disguise it as
        # "already saved" (that masked a NOT NULL violation for a long time).
        # Match on both Postgres (constraint name) and SQLite (column list).
        orig = str(getattr(e, "orig", e)).lower()
        is_duplicate = "uq_saved_job_user_listing" in orig or (
            "unique" in orig and "job_listing_id" in orig
        )
        if is_duplicate:
            raise HTTPException(status_code=409, detail="Job already saved") from None
        raise
    # Reload with relationship
    return await get_saved_job(db, sj.id, user_id)


async def save_manual_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: ManualJobCreate,
    *,
    origin: str | None = None,
) -> SavedJob:
    """Save a job the user found on an external site (FR-004a).

    Creates a `JobListing` with source="manual" — or reuses an existing
    listing when the same title/company/location is already known — then
    saves it for the user like any searched job.

    ``origin`` is how it got here (Scout, an email, Claude…); callers inside
    the app pass it, otherwise it is what the request said (the app's form or
    Job Catcher). A job the user already has keeps the origin it first had.
    """
    title_norm = normalize(data.title)
    company_norm = normalize(data.company)
    location_norm = normalize(data.location)
    content_hash = job_content_hash(title_norm, company_norm, location_norm)

    listing = await db.scalar(
        select(JobListing).where(JobListing.content_hash == content_hash)
    )
    if listing is not None and await _private_to_another(db, listing, user_id):
        # Another user's email-made job: its link opens THEIR mailbox (subject,
        # sender). Give this user their own listing instead of sharing it.
        content_hash = _own_hash(title_norm, company_norm, location_norm, user_id)
        listing = await db.scalar(
            select(JobListing).where(JobListing.content_hash == content_hash)
        )
    if listing is None:
        listing = JobListing(
            id=uuid.uuid4(),
            external_id=f"manual:{uuid.uuid4()}",
            source="manual",
            title=data.title,
            company=data.company,
            location=data.location,
            is_remote=data.is_remote,
            apply_url=data.url,
            description=data.description,
            salary_min=data.salary_min,
            salary_max=data.salary_max,
            salary_period=data.salary_period,
            job_type=data.job_type,
            content_hash=content_hash,
            title_normalized=title_norm,
            company_normalized=company_norm,
        )
        db.add(listing)
        await db.flush()
    else:
        # An explicit, user-reviewed save from the capture card: honor the
        # details the user typed/fixed. BUT job_listings is a SHARED pool, so we
        # only edit the row when it's a manual entry that no one else has saved —
        # never mutate a listing another user relies on. Overwrite only fields
        # the user provided (never wipe a value back to empty).
        others = await db.scalar(
            select(func.count())
            .select_from(SavedJob)
            .where(
                SavedJob.job_listing_id == listing.id,
                SavedJob.user_id != user_id,
            )
        )
        if listing.source == "manual" and not others:
            if data.description:
                listing.description = data.description
            if data.salary_min:
                listing.salary_min = data.salary_min
            if data.salary_max:
                listing.salary_max = data.salary_max
            if data.salary_period and (data.salary_min or data.salary_max):
                listing.salary_period = data.salary_period
            if data.job_type:
                listing.job_type = data.job_type
            listing.is_remote = data.is_remote
        await db.flush()

    # Already in the user's tracker? Then the edits above are the whole point of
    # this call — return the existing entry (so those edits commit) instead of
    # attempting a duplicate insert that 409s and rolls the whole transaction
    # back, silently discarding the user's change.
    existing = await db.scalar(
        select(SavedJob)
        .options(selectinload(SavedJob.job_listing))
        .where(
            SavedJob.user_id == user_id,
            SavedJob.job_listing_id == listing.id,
        )
    )
    if existing:
        return existing

    return await save_job(
        db,
        user_id,
        SavedJobCreate(
            job_listing_id=listing.id,
            collection_id=data.collection_id,
            notes=data.notes,
        ),
        origin=origin or data.origin,
    )


async def scout_fits(db: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, ScoutFit]:
    """Claude's fit score for each job Scout saved, by saved-job id (the newest
    finding wins when a job was found twice)."""
    rows = await db.execute(
        select(ScoutFinding.saved_job_id, ScoutFinding.fit_score, ScoutFinding.run_id)
        .where(
            ScoutFinding.user_id == user_id,
            ScoutFinding.saved_job_id.is_not(None),
            ScoutFinding.outcome == SAVED,
        )
        .order_by(ScoutFinding.created_at)
    )
    return {
        sj_id: ScoutFit(fit_score=fit, run_id=run_id) for sj_id, fit, run_id in rows
    }


async def doubtful_names(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """The user's email-made jobs whose name may be wrong (a title that reads
    like a sentence, or a company that is the person who sent the email) and
    that the user hasn't fixed or confirmed yet."""
    jobs = (
        await db.execute(
            select(SavedJob.id, JobListing.title, JobListing.company)
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .where(
                SavedJob.user_id == user_id,
                SavedJob.origin == ORIGIN_EMAIL,
                SavedJob.custom_title.is_(None),
                SavedJob.custom_company.is_(None),
            )
        )
    ).all()
    if not jobs:
        return set()
    senders: dict[uuid.UUID, list[str]] = {}
    for sj_id, from_addr in await db.execute(
        select(DetectedEvent.saved_job_id, DetectedEvent.from_addr).where(
            DetectedEvent.user_id == user_id,
            DetectedEvent.saved_job_id.in_([r.id for r in jobs]),
        )
    ):
        senders.setdefault(sj_id, []).append(from_addr or "")
    return {
        r.id
        for r in jobs
        if role_doubtful(r.title, strict=False)
        or any(is_sender_person(r.company, a) for a in senders.get(r.id, []))
    }


async def rename_listing(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID, data: ListingRename
) -> SavedJob:
    """Fix or confirm a saved job's title, company, place or link. Kept on the
    user's saved job and shown in place of the listing's own: the shared
    listing is never edited, so nobody else's job, search results or the
    extension's "already saved" check change."""
    sj = await get_saved_job(db, saved_job_id, user_id, with_description=False)
    if data.title is not None:
        sj.custom_title = data.title
    if data.company is not None:
        sj.custom_company = data.company
    if data.location is not None:
        sj.custom_location = data.location or None
    if data.apply_url is not None:
        sj.custom_apply_url = data.apply_url
        sj.apply_url_learned = False  # the user's own: never replaced
    await db.flush()
    return sj


async def own_names(
    db: AsyncSession, user_id: uuid.UUID, listing_id: uuid.UUID
) -> dict[str, str]:
    """The user's own name, place and link for a listing they saved, if any."""
    row = (
        await db.execute(
            select(
                SavedJob.custom_title,
                SavedJob.custom_company,
                SavedJob.custom_location,
                SavedJob.custom_apply_url,
            ).where(SavedJob.user_id == user_id, SavedJob.job_listing_id == listing_id)
        )
    ).first()
    if row is None:
        return {}
    names = dict(zip(("title", "company", "location", "apply_url"), row, strict=True))
    return {k: v for k, v in names.items() if v}


async def mark_applied(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    company: str,
    saved_job_id: uuid.UUID | None = None,
    *,
    company_only: bool = True,
) -> bool:
    """Auto-track: the extension saw the user SUBMIT an application — move the
    matching saved job to Applied. Prefers a title+company match; falls back to
    company-only (Indeed's confirmation states just the company) picking the
    most recent not-yet-applied saved job there (unless `company_only` is off:
    the title is known, so another job at that company is never the one).
    No match → no-op here (`track_applied` saves the job first when the page
    said what it is). With `saved_job_id`, that job or nothing (gone since the
    caller looked: never a guess at another job)."""
    title_norm = normalize(title)
    company_norm = normalize(company)
    sj = None
    if saved_job_id is not None:
        sj = await db.scalar(
            select(SavedJob).where(
                SavedJob.id == saved_job_id, SavedJob.user_id == user_id
            )
        )
        if sj is None:
            return False
    if sj is None and not title_norm and not company_norm:
        return False

    base = (
        select(SavedJob)
        .join(JobListing, SavedJob.job_listing_id == JobListing.id)
        .where(SavedJob.user_id == user_id)
    )
    if sj is None and title_norm and company_norm:
        sj = await db.scalar(
            base.where(
                JobListing.title_normalized == title_norm,
                JobListing.company_normalized == company_norm,
            ).limit(1)
        )
    if sj is None:
        # The names the user gave a job (a fixed email-made job is known by
        # those on the employer's page, not by the email's wording).
        for own, title_own, company_own in await _renamed(db, user_id):
            if company_own == company_norm and (
                not title_norm or title_own == title_norm
            ):
                sj = own
                break
    if sj is None and company_norm and company_only:
        # Company-only fallback: prefer a job not already applied, newest first.
        sj = await db.scalar(
            base.where(JobListing.company_normalized == company_norm)
            .order_by(SavedJob.applied_at.is_(None).desc(), SavedJob.created_at.desc())
            .limit(1)
        )
    if sj is None:
        return False
    await _set_applied(db, user_id, sj)
    return True


async def _set_applied(db: AsyncSession, user_id: uuid.UUID, sj: SavedJob) -> None:
    """Applied now (kept if it was already), in the Applied stage."""
    now = datetime.now(UTC)
    if sj.applied_at is None:
        sj.applied_at = now
    stage = await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == user_id, PipelineStage.name == "Applied"
        )
    )
    if stage and sj.pipeline_stage_id != stage.id:
        sj.pipeline_stage_id = stage.id
        sj.last_stage_change = now
    await db.flush()


async def track_applied(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    company: str,
    saved_job_id: uuid.UUID | None = None,
    create: AppliedJobCreate | None = None,
) -> tuple[bool, bool]:
    """A submitted application (spec 034): the saved job moves to Applied; a
    job never saved is saved from what the application page said (`create`)
    and marked applied, since the user did apply. Returns (matched, created).

    Once only: a second Submit (a double click, the page firing twice) finds
    the job saved the first time, by its link or its title and company."""
    if create is None or saved_job_id is not None:
        return await mark_applied(db, user_id, title, company, saved_job_id), False
    # Saved before from this very posting (the same link): that one.
    sj = await db.scalar(
        select(SavedJob)
        .join(JobListing, SavedJob.job_listing_id == JobListing.id)
        .where(SavedJob.user_id == user_id, JobListing.apply_url == create.url)
        .order_by(SavedJob.created_at.desc())
        .limit(1)
    )
    if sj is not None:
        await _set_applied(db, user_id, sj)
        return True, False
    # The same Workday posting saved from another address (the job page, a
    # board's link to it): same Workday site, same requisition id.
    sj = await _same_workday_posting(db, user_id, create.url)
    if sj is not None:
        await _set_applied(db, user_id, sj)
        return True, False
    if await mark_applied(
        db,
        user_id,
        title or create.title,
        company or create.company,
        company_only=False,
    ):
        return True, False
    # The page's company is only the Workday site's name ("Jj" for a site
    # called jj): the one saved, not-yet-applied job with this exact title
    # whose company that name could be short for, is this job.
    sj = await _only_by_title(db, user_id, title or create.title, create.url)
    if sj is not None:
        await _set_applied(db, user_id, sj)
        return True, False
    before = set(
        await db.scalars(select(SavedJob.id).where(SavedJob.user_id == user_id))
    )
    sj = await save_manual_job(
        db,
        user_id,
        ManualJobCreate(
            url=create.url,
            title=create.title,
            company=create.company,
            location=create.location or "Not specified",
            origin="extension",
        ),
    )
    await _set_applied(db, user_id, sj)
    # Saved just now, or a job the user already had (same title, company and
    # place): the panel says "Saved and marked applied" only for a new one.
    return True, sj.id not in before


_WORKDAY_HOST = re.compile(r"\.(myworkdayjobs|myworkdaysite)\.com$", re.I)


def workday_posting(url: str | None) -> tuple[str, str] | None:
    """A Workday posting's (site, requisition id): the host (plus the
    company's /recruiting/<name> on the shared myworkdaysite.com) and the id
    ending the job's path (…/job/Portland-OR/Title_JR-1001[/apply…])."""
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if not _WORKDAY_HOST.search(host):
        return None
    path = re.sub(
        r"/(apply|application)(/.*)?$", "", parts.path.rstrip("/"), flags=re.I
    )
    m = re.search(r"/job/(.+)$", path, re.I)
    last = m.group(1).split("/")[-1] if m else ""
    if "_" not in last:
        return None
    site = host
    if host.endswith("myworkdaysite.com"):
        tenant = re.search(r"/recruiting/([^/]+)", parts.path, re.I)
        site = f"{host}/{tenant.group(1).lower()}" if tenant else host
    return site, last.rsplit("_", 1)[1].lower()


async def _same_workday_posting(
    db: AsyncSession, user_id: uuid.UUID, url: str
) -> SavedJob | None:
    want = workday_posting(url)
    if want is None:
        return None
    rows = (
        await db.execute(
            select(SavedJob, JobListing.apply_url)
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .where(
                SavedJob.user_id == user_id,
                JobListing.apply_url.ilike(f"%{want[0].split('/')[0]}%"),
            )
            .order_by(SavedJob.created_at.desc())
        )
    ).all()
    for sj, link in rows:
        if (
            workday_posting(sj.custom_apply_url or link) == want
            or workday_posting(link) == want
        ):
            return sj
    return None


# Words a company's name ends with that a Workday site's name leaves out.
_NAME_TAIL = {
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "co",
    "company",
    "labs",
    "group",
    "holdings",
    "technologies",
    "international",
    "usa",
    "us",
    "plc",
}


def short_for(site_name: str, company: str) -> bool:
    """Could a Workday site's name be this company's? Exactly the company
    squashed together ("acmecorp" / "Acme Corp"), exactly its initials ("jj" /
    "Juniper & Jasper"), or the company's start followed only by words like
    Inc, Corp or Labs ("northwind" / "Northwind Labs"). Never a mere prefix:
    "ge" is not "Gemini Labs", "ab" not "Abbott"."""
    site = re.sub(r"[^a-z0-9]", "", (site_name or "").lower())
    words = [w for w in re.split(r"[^a-z0-9]+", (company or "").lower()) if w]
    words = [w for w in words if w != "and"]
    if len(site) < 2 or not words:
        return False
    if "".join(words) == site:
        return True
    # Initials, unless a word is itself the site's name and more ("GMR
    # Marketing" is not "gm").
    if "".join(w[0] for w in words) == site and not any(
        w.startswith(site) for w in words
    ):
        return True
    for n in range(1, len(words)):
        if "".join(words[:n]) == site and all(w in _NAME_TAIL for w in words[n:]):
            return True
    return False


async def _only_by_title(
    db: AsyncSession, user_id: uuid.UUID, title: str, url: str
) -> SavedJob | None:
    title_norm = normalize(title)
    where = workday_posting(url)
    if not title_norm or where is None:
        return None
    host = where[0]
    site_name = host.split("/", 1)[1] if "/" in host else host.split(".")[0]
    rows = (
        await db.scalars(
            select(SavedJob)
            .options(selectinload(SavedJob.job_listing))
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .where(
                SavedJob.user_id == user_id,
                SavedJob.applied_at.is_(None),
                JobListing.title_normalized == title_norm,
            )
        )
    ).all()
    fits = [
        sj
        for sj in rows
        if short_for(site_name, sj.custom_company or sj.job_listing.company)
    ]
    return fits[0] if len(fits) == 1 else None


async def _renamed(
    db: AsyncSession, user_id: uuid.UUID
) -> list[tuple[SavedJob, str, str]]:
    """The user's renamed jobs under their own (normalized) title and company."""
    rows = (
        await db.scalars(
            select(SavedJob)
            .options(
                selectinload(SavedJob.job_listing).options(
                    defer(JobListing.description)
                )
            )
            .where(
                SavedJob.user_id == user_id,
                (SavedJob.custom_title.is_not(None))
                | (SavedJob.custom_company.is_not(None)),
            )
        )
    ).all()
    return [
        (
            sj,
            normalize(sj.custom_title or sj.job_listing.title or ""),
            normalize(sj.custom_company or sj.job_listing.company or ""),
        )
        for sj in rows
        if sj.job_listing is not None
    ]


def _best_saved_match(
    title_norm: str,
    company_norm: str,
    candidates: list[tuple[SavedJob, str, str]],
) -> SavedJob | None:
    """The user's saved job that best matches an incoming application by fuzzy
    title+company, or None. Same scoring as dedup so it agrees with the rest of
    the app."""
    best: SavedJob | None = None
    best_title = 0
    for sj, cand_title, cand_company in candidates:
        if fuzz.token_sort_ratio(company_norm, cand_company) < _SYNC_COMPANY_THRESHOLD:
            continue
        title_score = fuzz.token_sort_ratio(title_norm, cand_title)
        if title_score >= _SYNC_TITLE_THRESHOLD and title_score > best_title:
            best = sj
            best_title = title_score
    return best


def _fallback_url(title: str, company: str) -> str:
    """A valid listing URL for an imported application when the board didn't
    give a per-job link — a search that lands the user on the posting."""
    q = quote_plus(f"{title} {company}".strip()) or "jobs"
    return f"https://www.indeed.com/jobs?q={q}"


async def sync_applications(
    db: AsyncSession,
    user_id: uuid.UUID,
    items: list[ApplicationSyncItem],
) -> ApplicationSyncResult:
    """Reconcile a batch of applications the user already made on a job board
    (read off their 'My jobs' list by the extension) with their tracker:

      • fuzzy-match each to a saved job → move it to the target stage, and
      • import the rest as new tracked jobs at that stage.

    The extension supplies the target stage NAME (already mapped from the board's
    status badge); we resolve it to the user's PipelineStage and never invent a
    stage the user doesn't have (falling back to 'Applied')."""
    stages = {
        s.name.lower(): s
        for s in (
            await db.execute(
                select(PipelineStage).where(PipelineStage.user_id == user_id)
            )
        ).scalars()
    }
    saved = (
        (
            await db.execute(
                select(SavedJob)
                # Matching uses titles/companies only; skip the descriptions.
                .options(
                    selectinload(SavedJob.job_listing).options(
                        defer(JobListing.description)
                    )
                )
                .where(SavedJob.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    candidates: list[tuple[SavedJob, str, str]] = [
        (
            sj,
            sj.job_listing.title_normalized or normalize(sj.job_listing.title or ""),
            sj.job_listing.company_normalized
            or normalize(sj.job_listing.company or ""),
        )
        for sj in saved
        if sj.job_listing is not None
    ]

    # A job the user renamed is also known by its own names.
    candidates += await _renamed(db, user_id)

    result = ApplicationSyncResult()
    now = datetime.now(UTC)

    for item in items:
        title_norm = normalize(item.title)
        company_norm = normalize(item.company)
        stage = stages.get(item.stage.lower()) or stages.get("applied")
        applied_ts = item.applied_at or now

        if not title_norm:
            result.skipped += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="skipped",
                )
            )
            continue

        match = _best_saved_match(title_norm, company_norm, candidates)
        if match is not None:
            if stage and match.pipeline_stage_id != stage.id:
                match.pipeline_stage_id = stage.id
                match.last_stage_change = now
            if match.applied_at is None:
                match.applied_at = applied_ts
            result.updated += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="updated",
                )
            )
            continue

        # No match — import it as a new tracked job at the target stage.
        try:
            sj = await save_manual_job(
                db,
                user_id,
                ManualJobCreate(
                    url=item.url or _fallback_url(item.title, item.company),
                    title=item.title,
                    company=item.company,
                    location=item.location or "Not specified",
                ),
                origin=ORIGIN_EXTENSION,
            )
        except HTTPException:
            # An unexpected exact-duplicate collision — treat as already tracked.
            result.skipped += 1
            result.outcomes.append(
                ApplicationSyncOutcome(
                    title=item.title,
                    company=item.company,
                    stage=item.stage,
                    action="skipped",
                )
            )
            continue

        if stage:
            sj.pipeline_stage_id = stage.id
            sj.last_stage_change = now
        sj.applied_at = applied_ts
        # Make it matchable for later items in the same batch (dedupes the list).
        candidates.append((sj, title_norm, company_norm))
        result.imported += 1
        result.outcomes.append(
            ApplicationSyncOutcome(
                title=item.title,
                company=item.company,
                stage=item.stage,
                action="imported",
            )
        )

    await db.flush()
    return result


async def update_saved_job(
    db: AsyncSession,
    saved_job_id: uuid.UUID,
    user_id: uuid.UUID,
    data: SavedJobUpdate,
) -> SavedJob:
    from datetime import datetime

    sj = await get_saved_job(db, saved_job_id, user_id, with_description=False)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("track_id") is not None:
        # Only one of the user's own resume types (404 otherwise).
        await get_track(db, updates["track_id"], user_id)

    # Track stage changes for follow-up reminders
    if (
        "pipeline_stage_id" in updates
        and updates["pipeline_stage_id"] != sj.pipeline_stage_id
    ):
        sj.last_stage_change = datetime.now(tz=UTC)

    for key, value in updates.items():
        setattr(sj, key, value)

    await db.flush()
    return sj


async def delete_saved_job(
    db: AsyncSession, saved_job_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    sj = await get_saved_job(db, saved_job_id, user_id, with_description=False)
    await db.delete(sj)
    await db.flush()
