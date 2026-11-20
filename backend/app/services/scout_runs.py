"""Claude Scout: saved searches, runs, and the tools Claude in Chrome calls.

The app is the memory and the planner; each chat with Claude stays small
(research R8):

- ``brief`` hands out short rules, the resume type and a ready-made search URL.
  It never sends lists of saved jobs or past findings.
- ``check_jobs`` answers "which of these rows are new?" for one results page,
  remembers the rows Claude passed over by title (``scout_passes``) and hands
  out the next page's link, up to ``MAX_PAGES`` pages a run.
- ``report_job`` takes a link plus Claude's opinion. The job saved is the exact
  page copy the Job Catcher extension captured (``record_capture``); nothing in
  it comes from Claude (research R9).
- An "Anything I'd be good at" search (spec 009) has no resume type's titles:
  Claude reads the resume (``get_master_profile``), picks the titles and sends
  them to ``set_search_titles``; the app builds the links and remembers how
  each title did (``scout_titles``).
- A "Local companies" search has no job board: ``check_companies`` says which
  of the businesses a Google search listed to visit (``scout_companies``), and
  ``company_checked`` records what each one's careers page had.

Functions Claude reaches through the connector raise ``ValueError`` with a
message Claude can act on; the page's REST functions raise ``HTTPException``.
"""

import hashlib
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.models.resume_track import ResumeTrack
from app.models.saved_job import SavedJob
from app.models.scout import (
    ANY_SITE_SOURCES,
    BELOW_BAR,
    DUPLICATE,
    LOCAL,
    NO_COPY,
    PASS_DAYS,
    PICKED,
    RUN_DONE,
    RUN_QUEUED,
    RUN_RUNNING,
    RUN_STOPPED,
    SAVED,
    SKIPPED,
    WAITING,
    ScoutCapture,
    ScoutFinding,
    ScoutMission,
    ScoutPass,
    ScoutRun,
)
from app.schemas.scout import (
    CaptureIn,
    FindingOut,
    MissionCreate,
    MissionOut,
    MissionUpdate,
    RunCounts,
    RunFolder,
    RunOut,
    RunTitle,
    place_problem,
)
from app.services import collections as col_svc
from app.services import scout_companies as companies
from app.services import scout_instructions as instr
from app.services import scout_review as review
from app.services import scout_titles as titles_svc
from app.services.scout_dedupe import (
    BOARD_HOSTS,
    company_key,
    is_job_site,
    posting_problem,
    title_key,
    url_key,
)
from app.services.scout_review import SOURCE_LABEL
from app.services.scout_tracks import BROAD, SCOPED, broad_track, get_track

PLAYBOOK_VERSION = "2026.11.7"
# What Claude is told lives in app/scout/*.md and scout_instructions (the user
# can edit most of it; a run uses its own snapshot).
SOURCE_STEP_KEYS = ("google_jobs", LOCAL)
NO_RESUME = "Upload your resume first: AI Apply → Your Resume."
RUBRIC = instr.RUBRIC
MAX_ROWS_PER_CHECK = 30
# Results pages a run reads before it stops (the user can change it), and how
# many of the resume type's titles one search asks for (runs take turns).
MAX_PAGES = instr.LIMITS["pages"]
TITLES_PER_SEARCH = 4
HOURS_PER_YEAR = 2080
# Findings that count as "seen": a job the user has decided on or has waiting
# to decide, or that Claude already judged. A job with no page copy isn't seen;
# it can be found again.
_SEEN = (SAVED, PICKED, SKIPPED, BELOW_BAR, DUPLICATE)
# What counts toward a run's target: good fits, confirmed yet or not.
_KEPT = (SAVED, PICKED)


def _now() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------- #
# Missions
# --------------------------------------------------------------------------- #
def mission_name(source: str, track_name: str, job_count: int, days: int) -> str:
    when = "today" if days == 1 else f"last {days} days"
    return f"{SOURCE_LABEL.get(source, source)} · {track_name} · {job_count} · {when}"[
        :80
    ]


async def list_missions(db: AsyncSession, user_id: uuid.UUID) -> Sequence[ScoutMission]:
    return (
        await db.scalars(
            select(ScoutMission)
            .where(ScoutMission.user_id == user_id)
            .order_by(
                ScoutMission.last_run_at.desc().nulls_last(),
                ScoutMission.created_at.desc(),
            )
        )
    ).all()


async def get_mission(
    db: AsyncSession, mission_id: uuid.UUID, user_id: uuid.UUID
) -> ScoutMission:
    mission = await db.scalar(
        select(ScoutMission).where(
            ScoutMission.id == mission_id, ScoutMission.user_id == user_id
        )
    )
    if mission is None:
        raise HTTPException(status_code=404, detail="Search not found")
    return mission


async def create_mission(
    db: AsyncSession, user_id: uuid.UUID, data: MissionCreate
) -> ScoutMission:
    if data.broad:
        track = await broad_track(db, user_id)
    else:
        track = await get_track(db, data.track_id, user_id)
    if data.collection_id is not None:
        await col_svc.get_collection(db, data.collection_id, user_id)
    values = data.model_dump(exclude={"broad"})
    values["track_id"] = track.id
    values["name"] = values["name"] or mission_name(
        data.source, track.name, data.job_count, data.posted_within_days
    )
    mission = ScoutMission(id=uuid.uuid4(), user_id=user_id, **values)
    db.add(mission)
    await db.flush()
    return mission


async def update_mission(
    db: AsyncSession, mission_id: uuid.UUID, user_id: uuid.UUID, data: MissionUpdate
) -> ScoutMission:
    mission = await get_mission(db, mission_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    broad = updates.pop("broad", None)
    if broad:
        updates["track_id"] = (await broad_track(db, user_id)).id
    elif updates.get("track_id") is not None:
        await get_track(db, updates["track_id"], user_id)
    if updates.get("collection_id") is not None:
        await col_svc.get_collection(db, updates["collection_id"], user_id)
    old_track = await get_track(db, mission.track_id, user_id, allow_broad=True)
    if broad is False and old_track.kind == BROAD and not updates.get("track_id"):
        raise HTTPException(status_code=422, detail="Choose a resume type.")
    auto_named = mission.name == mission_name(
        mission.source, old_track.name, mission.job_count, mission.posted_within_days
    )
    for key, value in updates.items():
        if value is None and key not in (
            "min_pay",
            "location",
            "radius_miles",
            "extra_instructions",
            "collection_id",
            "overrides",
        ):
            continue  # required fields: null means "leave as is"
        setattr(mission, key, value)
    problem = place_problem(mission.source, mission.location, mission.remote)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    renamed = "name" in updates and updates["name"]
    if not renamed and (auto_named or "name" in updates):
        track = await get_track(db, mission.track_id, user_id, allow_broad=True)
        mission.name = mission_name(
            mission.source, track.name, mission.job_count, mission.posted_within_days
        )
    await db.flush()
    return mission


async def missions_out(
    db: AsyncSession, user_id: uuid.UUID, missions: Sequence[ScoutMission]
) -> list[MissionOut]:
    """Searches for the page, each with the name of the collection its jobs go
    into: the one chosen, or the one named after its resume type."""
    if not missions:
        return []
    chosen = [m.collection_id for m in missions if m.collection_id]
    names: dict = {}
    if chosen:
        names = dict(
            (
                await db.execute(
                    select(Collection.id, Collection.name).where(
                        Collection.user_id == user_id, Collection.id.in_(chosen)
                    )
                )
            ).all()
        )
    tracks = {
        tid: (name, kind)
        for tid, name, kind in (
            await db.execute(
                select(ResumeTrack.id, ResumeTrack.name, ResumeTrack.kind).where(
                    ResumeTrack.user_id == user_id
                )
            )
        ).all()
    }
    out = []
    for m in missions:
        item = MissionOut.model_validate(m)
        name, kind = tracks.get(m.track_id, ("", SCOPED))
        item.broad = kind == BROAD
        if m.collection_id not in names:  # the chosen collection is gone
            item.collection_id = None
        item.collection_name = names.get(m.collection_id) or review.default_folder_name(
            {"track": {"name": name}, "broad": item.broad}
        )
        out.append(item)
    return out


async def delete_mission(
    db: AsyncSession, mission_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    await db.delete(await get_mission(db, mission_id, user_id))
    await db.flush()


# --------------------------------------------------------------------------- #
# Runs (the page's side)
# --------------------------------------------------------------------------- #
def search_titles(c: dict) -> list[str]:
    """The titles one search asks for. A resume type with more than
    ``TITLES_PER_SEARCH`` takes turns: each run (``round``) asks for the next
    ones, so runs don't all see the same results."""
    if c.get("broad"):  # Claude's own, set with set_search_titles
        return list(c.get("search_titles") or [])
    titles = list(c["track"]["titles"] or [])
    if len(titles) <= TITLES_PER_SEARCH:
        return titles or [c["track"]["name"]]
    first = (int(c.get("round") or 0) * TITLES_PER_SEARCH) % len(titles)
    return (titles[first:] + titles[:first])[:TITLES_PER_SEARCH]


def start_urls(c: dict) -> list[str]:
    """The search page Claude opens, with the filters already set, so it never
    spends screenshots clicking through them."""
    titles = search_titles(c)
    days = c["posted_within_days"]
    location = c.get("location") or ""
    remote = c.get("remote", "any")
    # "Within N miles" only means something around a place, for jobs you'd
    # travel to. Each board has its own name for it.
    radius = c.get("radius_miles") if location and remote != "remote_only" else None
    if c["source"] == "linkedin":
        q = {
            "keywords": " OR ".join(f'"{t}"' for t in titles),
            "location": location
            or ("United States" if remote == "remote_only" else ""),
            "f_TPR": f"r{days * 86400}",
            "sortBy": "DD",
        }
        if remote == "remote_only":
            q["f_WT"] = "2"
        elif remote == "no_remote":
            q["f_WT"] = "1,3"
        if radius:
            q["distance"] = str(radius)
        return [f"https://www.linkedin.com/jobs/search/?{urlencode(q)}"]
    query = " OR ".join(f'"{t}"' for t in titles)
    where = "Remote" if remote == "remote_only" else location
    if c["source"] == LOCAL:
        return company_searches(c)
    if c["source"] == "google_jobs":
        if remote == "remote_only":
            q = f"{query} remote jobs"
        elif location:
            near = f"within {radius} miles of" if radius else "near"
            q = f"{query} jobs {near} {location}"
        else:
            q = f"{query} jobs"
        # udm=8: Google's own Jobs results.
        return [f"https://www.google.com/search?{urlencode({'q': q, 'udm': '8'})}"]
    if c["source"] == "indeed":
        q = {"q": query, "l": where, "fromage": str(min(days, 14)), "sort": "date"}
        if radius:
            q["radius"] = str(radius)
        return [f"https://www.indeed.com/jobs?{urlencode(q)}"]
    zip_days = next(d for d in (1, 5, 10, 30) if d >= days)
    q = {"search": query, "location": where, "days": str(zip_days)}
    if radius:
        q["radius"] = str(radius)
    return [f"https://www.ziprecruiter.com/jobs-search?{urlencode(q)}"]


def page_url(c: dict, pages_read: int) -> str | None:
    """The link to the next results page after ``pages_read`` pages, so Claude
    opens it instead of finding and clicking the board's page buttons. None
    where results don't come in numbered pages (Google)."""
    source = c["source"]
    if source not in ("linkedin", "indeed", "ziprecruiter"):
        return None
    url = start_urls(c)[0]
    if source == "ziprecruiter":
        return f"{url}&page={pages_read + 1}"
    per_page = 25 if source == "linkedin" else 10
    return f"{url}&start={pages_read * per_page}"


def run_tip(run: ScoutRun, counts: dict[str, int]) -> str | None:
    """One line on what to change when a finished search came back short (the
    page shows it under the numbers). None when it found what was asked."""
    c = run.criteria or {}
    if run.status not in (RUN_DONE, RUN_STOPPED) or c.get("source") == LOCAL:
        return None
    found = sum(counts.get(o, 0) for o in (PICKED, SAVED, SKIPPED))
    s = run.stats or {}
    rows = s.get("rows", 0)
    if found >= c.get("job_count", 0) or not rows:
        return None
    days = c.get("posted_within_days", 7)
    wider = next((d for d in (3, 7, 14, 30) if d > days), None)
    widen = f'widen "Posted" to "Last {wider} days"' if wider else ""
    radius = c.get("radius_miles")
    if (s.get("seen_before", 0) + s.get("in_tracker", 0)) * 2 >= rows:
        return (
            "Most of these jobs were already seen: the search ran recently and "
            "few new ones have been posted since. Give it a day"
            + (f", or {widen}." if widen else ".")
        )
    if s.get("title_passed", 0) * 2 >= rows:
        if c.get("broad"):
            return (
                "Most job titles didn't fit you. The next run tries other titles; "
                "add Never titles to rule some out for good."
            )
        return (
            "Most job titles didn't fit the resume type. Add the titles you want "
            "to the resume type so the search asks for them."
        )
    pages_limit = instr.limit(c, "pages")
    ran_out = run.status == RUN_DONE and s.get("pages", pages_limit) < pages_limit
    if ran_out and (widen or (radius and radius < 100)):
        more = [w for w in (widen, "pick a bigger radius" if radius else "") if w]
        return f"The search ran out of results. For more, {' or '.join(more)}."
    return None


# Kinds of local employers a "Local companies" search looks through, a couple
# per run, so runs reach different businesses.
EMPLOYER_KINDS = (
    "largest employers",
    "hospitals and clinics",
    "manufacturing companies",
    "banks and credit unions",
    "school districts and colleges",
    "law firms",
    "engineering firms",
    "software and IT companies",
    "logistics and distribution companies",
    "insurance companies",
    "city and county government offices",
    "nonprofit organizations",
    "accounting firms",
    "construction companies",
    "company headquarters",
)
# Keeps job boards out of the plain results.
_NOT_BOARDS = "-indeed -linkedin -glassdoor -ziprecruiter"


def company_searches(c: dict) -> list[str]:
    """Google searches for businesses near the user: one from the resume type
    (its name or one of its titles, in turn) and two kinds of employer. Each run
    (``round``) moves on to the next ones."""
    track = c["track"]
    titles = track.get("titles") or []
    location = c.get("location") or ""
    radius = c.get("radius_miles")
    near = f"within {radius} miles of {location}" if radius else f"near {location}"
    n = int(c.get("round") or 0)
    if c.get("broad"):  # the titles Claude chose for this run
        roles = [f"companies that hire {t}" for t in search_titles(c)] or [
            "largest employers"
        ]
    else:
        roles = [f"{track['name']} companies"] + [
            f"companies that hire {t}" for t in titles
        ]
    kinds = len(EMPLOYER_KINDS)
    queries = [
        roles[n % len(roles)],
        EMPLOYER_KINDS[(2 * n) % kinds],
        EMPLOYER_KINDS[(2 * n + 1) % kinds],
    ]
    return [
        f"https://www.google.com/search?{urlencode({'q': f'{q} {near} {_NOT_BOARDS}'})}"
        for q in queries
    ]


async def _criteria(
    db: AsyncSession, user_id: uuid.UUID, mission: ScoutMission, track: ResumeTrack
) -> dict:
    """A run's snapshot of its search, resume type and instructions, so later
    edits never change a run that's already going."""
    broad = track.kind == BROAD
    overrides = titles_svc.overrides({"overrides": mission.overrides})
    skip = dict(track.skip_rules or {})
    if broad:
        skip["exclude"] = list(skip.get("exclude") or []) + overrides["avoid"]
    criteria = {
        "name": mission.name,
        "source": mission.source,
        "job_count": mission.job_count,
        "posted_within_days": mission.posted_within_days,
        "min_pay": mission.min_pay if mission.min_pay is not None else track.min_pay,
        "location": mission.location,
        "radius_miles": mission.radius_miles,
        "remote": mission.remote,
        "min_fit": mission.min_fit,
        "extra_instructions": mission.extra_instructions,
        # Where good fits go, and whether the user confirms them first.
        "collection_id": str(mission.collection_id) if mission.collection_id else None,
        "auto_save": bool(mission.auto_save),
        # How many runs this search has had: a Local companies search moves on
        # to different Google searches each time.
        "round": await db.scalar(
            select(func.count()).where(ScoutRun.mission_id == mission.id)
        )
        or 0,
        "track": {
            "name": track.name,
            "titles": list(track.target_titles or []),
            "skills": list(track.key_skills or []),
            "skip": skip,
            "notes": track.notes,
        },
    }
    if broad:
        # Claude picks the titles; the user's overrides as they were at Start.
        criteria["broad"] = True
        criteria["overrides"] = overrides
    criteria.update(await instr.snapshot(db, user_id))
    return criteria


async def queue_run(
    db: AsyncSession, mission_id: uuid.UUID, user_id: uuid.UUID
) -> ScoutRun:
    mission = await get_mission(db, mission_id, user_id)
    track = await get_track(db, mission.track_id, user_id, allow_broad=True)
    if track.kind == BROAD and not await resume_ready(db, user_id):
        raise HTTPException(status_code=422, detail=NO_RESUME)
    criteria = await _criteria(db, user_id, mission, track)
    run = ScoutRun(
        id=uuid.uuid4(),
        user_id=user_id,
        mission_id=mission.id,
        track_id=track.id,
        criteria=criteria,
        playbook_version=PLAYBOOK_VERSION,
        status=RUN_QUEUED,
    )
    mission.last_run_at = _now()
    db.add(run)
    await db.flush()
    return run


async def get_run(db: AsyncSession, run_id: uuid.UUID, user_id: uuid.UUID) -> ScoutRun:
    run = await db.scalar(
        select(ScoutRun).where(ScoutRun.id == run_id, ScoutRun.user_id == user_id)
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def list_runs(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 30
) -> Sequence[ScoutRun]:
    """The latest runs, plus any older one with picks still waiting (so the
    count on Find Jobs always has a review to go with it)."""
    latest = list(
        (
            await db.scalars(
                select(ScoutRun)
                .where(ScoutRun.user_id == user_id)
                .order_by(ScoutRun.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    have = {r.id for r in latest}
    waiting = (
        await db.scalars(
            select(ScoutRun)
            .where(
                ScoutRun.user_id == user_id,
                ScoutRun.id.in_(
                    select(ScoutFinding.run_id).where(
                        ScoutFinding.user_id == user_id,
                        ScoutFinding.outcome == PICKED,
                    )
                ),
            )
            .order_by(ScoutRun.created_at.desc())
        )
    ).all()
    return latest + [r for r in waiting if r.id not in have]


async def stop_run(db: AsyncSession, run_id: uuid.UUID, user_id: uuid.UUID) -> ScoutRun:
    run = await get_run(db, run_id, user_id)
    if run.status in (RUN_QUEUED, RUN_RUNNING):
        run.status = RUN_STOPPED
        run.finished_at = _now()
        await db.flush()
    return run


async def _counts(db: AsyncSession, run_ids: list[uuid.UUID]) -> dict:
    rows = (
        await db.execute(
            select(ScoutFinding.run_id, ScoutFinding.outcome, func.count())
            .where(ScoutFinding.run_id.in_(run_ids))
            .group_by(ScoutFinding.run_id, ScoutFinding.outcome)
        )
    ).all()
    out: dict[uuid.UUID, dict[str, int]] = {}
    for run_id, outcome, n in rows:
        out.setdefault(run_id, {})[outcome] = n
    return out


async def runs_out(
    db: AsyncSession, runs: Sequence[ScoutRun], *, with_findings: bool = False
) -> list[RunOut]:
    if not runs:
        return []
    counts = await _counts(db, [r.id for r in runs])
    fits_by_title = await _fits_by_title(
        db, [r.id for r in runs if (r.criteria or {}).get("broad")]
    )
    findings: dict[uuid.UUID, list[FindingOut]] = {}
    folders: dict[uuid.UUID, RunFolder] = {}
    if with_findings:
        rows = (
            await db.execute(
                select(
                    ScoutFinding,
                    SavedJob.job_listing_id,
                    Collection.id,
                    Collection.name,
                )
                .outerjoin(SavedJob, SavedJob.id == ScoutFinding.saved_job_id)
                .outerjoin(Collection, Collection.id == SavedJob.collection_id)
                .where(ScoutFinding.run_id.in_([r.id for r in runs]))
                .order_by(ScoutFinding.fit_score.desc(), ScoutFinding.created_at)
            )
        ).all()
        # A finding can still be saved only while its page copy exists.
        keys = {f.url_key for f, *_ in rows if f.outcome in review.SAVEABLE}
        copied: set[str] = set()
        if keys:
            copied = set(
                await db.scalars(
                    select(ScoutCapture.url_key)
                    .where(
                        ScoutCapture.user_id.in_({r.user_id for r in runs}),
                        ScoutCapture.url_key.in_(keys),
                    )
                    .distinct()
                )
            )
        closest = {f.closest_track_id for f, *_ in rows if f.closest_track_id}
        track_names = (
            dict(
                (
                    await db.execute(
                        select(ResumeTrack.id, ResumeTrack.name).where(
                            ResumeTrack.id.in_(closest)
                        )
                    )
                ).all()
            )
            if closest
            else {}
        )
        for f, listing_id, collection_id, collection_name in rows:
            item = FindingOut.model_validate(f)
            item.closest_track_name = track_names.get(f.closest_track_id)
            item.job_listing_id = listing_id
            item.collection_id, item.collection_name = collection_id, collection_name
            item.can_save = f.outcome in review.SAVEABLE and f.url_key in copied
            findings.setdefault(f.run_id, []).append(item)
        for r in runs:
            folders[r.id] = await review.peek_folder(db, r.user_id, r.criteria or {})
    out = []
    for r in runs:
        c = r.criteria or {}
        run_counts = RunCounts(**counts.get(r.id, {}))
        out.append(
            RunOut(
                id=r.id,
                mission_id=r.mission_id,
                name=c.get("name", ""),
                source=c.get("source", ""),
                track_name=(c.get("track") or {}).get("name", ""),
                target=c.get("job_count", 0),
                status=r.status,
                note=r.note,
                created_at=r.created_at,
                started_at=r.started_at,
                finished_at=r.finished_at,
                counts=run_counts,
                needs_review=run_counts.picked > 0,
                folder=folders.get(r.id),
                looked_at=(
                    {k: v for k, v in r.stats.items() if not k.startswith("_")}
                    if r.stats
                    else None
                ),
                tip=run_tip(r, counts.get(r.id, {})),
                instructions=c.get("instructions"),
                broad=bool(c.get("broad")),
                titles=[
                    RunTitle(title=t, good_fits=fits_by_title.get((r.id, t), 0))
                    for t in c.get("search_titles") or []
                ],
                findings=findings.get(r.id, []),
            )
        )
    return out


async def _fits_by_title(
    db: AsyncSession, run_ids: list[uuid.UUID]
) -> dict[tuple[uuid.UUID, str], int]:
    """Good fits per searched title, for broad runs' History."""
    if not run_ids:
        return {}
    rows = await db.execute(
        select(ScoutFinding.run_id, ScoutFinding.search_title, func.count())
        .where(
            ScoutFinding.run_id.in_(run_ids),
            ScoutFinding.search_title.is_not(None),
            ScoutFinding.outcome.in_((PICKED, SAVED, SKIPPED)),
        )
        .group_by(ScoutFinding.run_id, ScoutFinding.search_title)
    )
    return {(rid, title): n for rid, title, n in rows.all()}


async def _open_run(db: AsyncSession, user_id: uuid.UUID) -> ScoutRun | None:
    """The run Claude works on next: the oldest running one, else the oldest
    queued one. The extension files page copies under the same run."""
    return await db.scalar(
        select(ScoutRun)
        .where(ScoutRun.user_id == user_id, ScoutRun.status == RUN_RUNNING)
        .order_by(ScoutRun.started_at)
        .limit(1)
    ) or await db.scalar(
        select(ScoutRun)
        .where(ScoutRun.user_id == user_id, ScoutRun.status == RUN_QUEUED)
        .order_by(ScoutRun.created_at)
        .limit(1)
    )


async def active_run_id(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    run = await _open_run(db, user_id)
    return run.id if run else None


open_run = _open_run


async def any_site_run(db: AsyncSession, user_id: uuid.UUID) -> ScoutRun | None:
    """The running search whose postings live on any site (Google Jobs, Local
    companies), if any: only then are pages beyond the three job boards
    copied. Never a queued one; an older run left running doesn't hide it."""
    running = (
        await db.scalars(
            select(ScoutRun)
            .where(ScoutRun.user_id == user_id, ScoutRun.status == RUN_RUNNING)
            .order_by(ScoutRun.started_at.desc())
        )
    ).all()
    return next(
        (r for r in running if (r.criteria or {}).get("source") in ANY_SITE_SOURCES),
        None,
    )


async def record_capture(db: AsyncSession, user_id: uuid.UUID, data: CaptureIn) -> bool:
    """Keep the extension's exact copy of a posting for the open run. Returns
    False (nothing stored) when no run is open or the link isn't a posting."""
    run = await _open_run(db, user_id)
    key = url_key(data.url)
    if run is None or key is None or posting_problem(data.url):
        return False
    host = (urlsplit(data.url).hostname or "").lower()
    on_board = any(host == b or host.endswith(f".{b}") for b in BOARD_HOSTS)
    if not on_board:
        run = await any_site_run(db, user_id)
        if run is None:
            return False  # some other site, and no search that looks there
    run_id = run.id
    values = data.model_dump()
    capture = await db.scalar(
        select(ScoutCapture).where(
            ScoutCapture.run_id == run_id, ScoutCapture.url_key == key
        )
    )
    if capture is None:
        db.add(
            ScoutCapture(
                id=uuid.uuid4(), user_id=user_id, run_id=run_id, url_key=key, **values
            )
        )
    else:
        for field, value in values.items():
            setattr(capture, field, value)
        capture.captured_at = _now()
    await db.flush()
    return True


# --------------------------------------------------------------------------- #
# Claude's side (through the connector)
# --------------------------------------------------------------------------- #
async def _run_for_agent(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, *, start: bool = False
) -> ScoutRun:
    """The run a tool call is about. Only get_scout_brief (start=True) moves a
    queued run to running; the other tools never pick up a run by themselves."""
    if run_id:
        try:
            rid = uuid.UUID(str(run_id))
        except ValueError:
            raise ValueError(f"'{run_id}' isn't a run id.") from None
        run = await db.scalar(
            select(ScoutRun).where(ScoutRun.id == rid, ScoutRun.user_id == user_id)
        )
        if run is None:
            raise ValueError("No such Scout run. Call get_scout_brief with no run_id.")
    else:
        run = await _open_run(db, user_id)
        if run is None:
            raise ValueError(
                "No Scout run is waiting. Ask the user to press Start in the app "
                "(Find Jobs → Claude Scout), then call get_scout_brief again."
            )
    if run.status in (RUN_DONE, RUN_STOPPED):
        raise ValueError(
            f"This run is {run.status}. Stop here; the user can start another "
            "in the app."
        )
    if run.status == RUN_QUEUED:
        if not start:
            raise ValueError("This run hasn't started. Call get_scout_brief first.")
        run.status = RUN_RUNNING
        run.started_at = _now()
        await db.flush()
    return run


async def _kept_count(db: AsyncSession, run_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).where(
                ScoutFinding.run_id == run_id, ScoutFinding.outcome.in_(_KEPT)
            )
        )
        or 0
    )


async def _progress(db: AsyncSession, run: ScoutRun) -> dict:
    """How far the run is toward its target. "kept" = good fits found, whether
    the user has confirmed them yet or not."""
    kept = await _kept_count(db, run.id)
    target = run.criteria["job_count"]
    return {"kept": kept, "target": target, "done": kept >= target}


def _saving_note(criteria: dict) -> str:
    """One line for Claude on what happens to a good fit."""
    if criteria.get("auto_save"):
        return "Good fits are saved straight into the user's collection."
    return (
        "Good fits are kept in the app for the user to tick and save. You never "
        "save a job yourself, so never tell the user a job was saved."
    )


async def resume_ready(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """The user has an active resume with text Claude can read."""
    return (
        await db.scalar(
            select(Resume.id)
            .where(
                Resume.user_id == user_id,
                Resume.is_active.is_(True),
                func.length(func.trim(func.coalesce(Resume.extracted_text, ""))) > 0,
            )
            .limit(1)
        )
    ) is not None


async def _resume_types(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's resume types, short, so Claude can say which one a job is
    closest to."""
    rows = await db.execute(
        select(ResumeTrack.name, ResumeTrack.target_titles)
        .where(ResumeTrack.user_id == user_id, ResumeTrack.kind == SCOPED)
        .order_by(ResumeTrack.sort_order, ResumeTrack.created_at)
    )
    return [{"name": n, "titles": list(t or [])[:4]} for n, t in rows.all()]


async def brief(db: AsyncSession, user_id: uuid.UUID, run_id: str | None) -> dict:
    run = await _run_for_agent(db, user_id, run_id, start=True)
    return await _brief_body(db, user_id, run, await _progress(db, run))


async def preview(db: AsyncSession, user_id: uuid.UUID, mission_id: uuid.UUID) -> dict:
    """What Claude would be given if this search started now. Nothing is
    created or marked: the run here is never saved."""
    mission = await get_mission(db, mission_id, user_id)
    track = await get_track(db, mission.track_id, user_id, allow_broad=True)
    run = ScoutRun(
        id=None,
        user_id=user_id,
        mission_id=mission.id,
        track_id=track.id,
        criteria=await _criteria(db, user_id, mission, track),
        playbook_version=PLAYBOOK_VERSION,
        status=RUN_QUEUED,
    )
    target = run.criteria["job_count"]
    progress = {"kept": 0, "target": target, "done": False}
    return {
        **await _brief_body(db, user_id, run, progress, preview=True),
        "preview": True,
    }


async def _brief_body(
    db: AsyncSession,
    user_id: uuid.UUID,
    run: ScoutRun,
    progress: dict,
    *,
    preview: bool = False,
) -> dict:
    c = run.criteria
    local = c["source"] == LOCAL
    ready = await resume_ready(db, user_id)
    extra: dict = {"resume_ready": ready}
    if c["source"] in SOURCE_STEP_KEYS:
        extra["source_steps"] = instr.text_for(c, c["source"])
        extra["posted_within_days"] = c["posted_within_days"]
    if not local:
        extra["max_pages"] = instr.limit(c, "pages")
    first = "Open the start URL and send the first page of rows to check_jobs."
    if local:
        # Choosing re-checks marks them handed out: a preview only says so.
        extra["recheck"] = (
            "Chosen when the run starts."
            if preview
            else await companies.rechecks(db, user_id, run)
        )
        extra["companies"] = companies.counts(run)
        first = (
            "Visit the recheck companies first. Then open"
            if extra["recheck"]
            else "Open"
        ) + " the first start URL and send the companies it lists to check_companies."
    broad = bool(c.get("broad"))
    choosing = broad and not c.get("search_titles")
    if broad:
        ov = titles_svc.overrides(c)
        extra.update(
            broad=True,
            broad_steps=instr.text_for(c, "broad"),
            max_titles=instr.limit(c, "titles"),
            titles_tried=await titles_svc.for_brief(db, run),
            always=ov["always"],
            never=ov["never"],
            avoid=ov["avoid"],
            resume_types=await _resume_types(db, user_id),
        )
    if choosing:
        first = (
            "Call get_master_profile, choose up to "
            f"{instr.limit(c, 'titles')} job titles the user would be good at (see "
            "broad_steps), then call set_search_titles: it gives you the start URLs."
        )
    elif ready:
        first = (
            "Call get_master_profile once and score every job against the resume. "
            f"Then {first[0].lower()}{first[1:]}"
        )
    rubric = instr.rubric_for(c)
    return {
        "run_id": str(run.id) if run.id else None,
        "playbook": instr.assemble_playbook(instr.text_for(c, "playbook"), rubric),
        "playbook_version": run.playbook_version,
        "source": c["source"],
        **extra,
        "start_urls": [] if choosing else start_urls(c),
        "track": c["track"],
        "min_pay": c.get("min_pay"),
        "min_fit": c["min_fit"],
        "rubric": rubric,
        "extra_instructions": c.get("extra_instructions"),
        "saving": _saving_note(c),
        "progress": progress,
        "next": "Target reached: call finish_scout_run." if progress["done"] else first,
    }


def _excluded(title: str, words: list[str]) -> bool:
    t = f" {title_key(title)} "
    return any(f" {title_key(w)} " in t for w in words if title_key(w))


async def _seen_jobs(
    db: AsyncSession,
    user_id: uuid.UUID,
    pairs: set[tuple[str, str]],
    urls: set[str],
    *,
    skip_finding: uuid.UUID | None = None,
) -> dict[tuple[str, str] | str, str]:
    """Which of these (company_key, title_key) pairs and url keys are already
    known, and why. Queries only rows with matching titles or links, so the
    cost doesn't grow with the size of the tracker."""
    titles = {t for _, t in pairs if t}
    seen: dict[tuple[str, str] | str, str] = {}
    if titles:
        tracked = (
            await db.execute(
                select(JobListing.company, JobListing.title_normalized)
                .join(SavedJob, SavedJob.job_listing_id == JobListing.id)
                .where(
                    SavedJob.user_id == user_id,
                    JobListing.title_normalized.in_(titles),
                )
            )
        ).all()
        for company, t in tracked:
            if (company_key(company), t) in pairs:
                seen[(company_key(company), t)] = "in_tracker"
        # A job the user renamed is in the tracker under its own name too.
        renamed = (
            await db.execute(
                select(
                    func.coalesce(SavedJob.custom_company, JobListing.company),
                    SavedJob.custom_title,
                )
                .join(JobListing, SavedJob.job_listing_id == JobListing.id)
                .where(SavedJob.user_id == user_id, SavedJob.custom_title.is_not(None))
            )
        ).all()
        for company, own_title in renamed:
            pair = (company_key(company), title_key(own_title))
            if pair in pairs:
                seen[pair] = "in_tracker"
    conditions = []
    if titles:
        conditions.append(ScoutFinding.title_key.in_(titles))
    if urls:
        conditions.append(ScoutFinding.url_key.in_(urls))
    if conditions:
        query = select(
            ScoutFinding.company_key, ScoutFinding.title_key, ScoutFinding.url_key
        ).where(
            ScoutFinding.user_id == user_id,
            ScoutFinding.outcome.in_(_SEEN),
            or_(*conditions),
        )
        if skip_finding is not None:
            query = query.where(ScoutFinding.id != skip_finding)
        for ck, tk, uk in (await db.execute(query)).all():
            if (ck, tk) in pairs:
                seen.setdefault((ck, tk), "seen_before")
            if uk in urls:
                seen.setdefault(uk, "seen_before")
    return seen


async def _passed(
    db: AsyncSession,
    user_id: uuid.UUID,
    track_id: uuid.UUID | None,
    pairs: set[tuple[str, str]],
    urls: set[str],
) -> set[tuple[str, str] | str]:
    """Which of these rows Claude passed over by title for this resume type in
    the last ``PASS_DAYS``."""
    titles = {t for _, t in pairs if t}
    if track_id is None or not (titles or urls):
        return set()
    conditions = []
    if titles:
        conditions.append(ScoutPass.title_key.in_(titles))
    if urls:
        conditions.append(ScoutPass.url_key.in_(urls))
    rows = await db.execute(
        select(ScoutPass.company_key, ScoutPass.title_key, ScoutPass.url_key).where(
            ScoutPass.user_id == user_id,
            ScoutPass.track_id == track_id,
            ScoutPass.created_at >= _now() - timedelta(days=PASS_DAYS),
            or_(*conditions),
        )
    )
    out: set[tuple[str, str] | str] = set()
    for ck, tk, uk in rows.all():
        if (ck, tk) in pairs:
            out.add((ck, tk))
        if uk and uk in urls:
            out.add(uk)
    return out


def _fits(row: dict) -> bool:
    """Claude's call on the title alone; a row without one is opened."""
    fits = row.get("fits", True)
    if isinstance(fits, str):
        return fits.strip().lower() not in ("false", "no", "0")
    return fits is not False


async def check_jobs(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, rows: list[dict]
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    if len(rows) > MAX_ROWS_PER_CHECK:
        raise ValueError(f"Send at most {MAX_ROWS_PER_CHECK} rows per call (one page).")
    c = run.criteria
    exclude = c["track"].get("skip", {}).get("exclude", [])
    keyed = []
    for row in rows:
        row = row if isinstance(row, dict) else {}
        # Cut to the stored keys' lengths, so a very long title still matches.
        pair = (
            company_key(str(row.get("company", "")))[:255],
            title_key(str(row.get("title", "")))[:500],
        )
        uk = url_key(str(row.get("url") or ""))
        keyed.append((row, pair, uk))
    pairs = {p for _, p, _ in keyed if p[0] and p[1]}
    urls = {u for _, _, u in keyed if u}
    seen = await _seen_jobs(db, user_id, pairs, urls)
    # Rows passed over by title before (an earlier run, or an earlier page).
    passed = await _passed(db, user_id, run.track_id, pairs, urls)

    # Why each row isn't opened, or None for a row worth opening.
    reasons: list[str | None] = []
    passed_before: list[bool] = []
    for row, pair, uk in keyed:
        why = seen.get(pair) or (seen.get(uk) if uk else None)
        before = not why and (pair in passed or (uk is not None and uk in passed))
        if before:
            why = "title_passed"
        if not why and _excluded(str(row.get("title", "")), exclude):
            why = "excluded"
        if not why and not _fits(row):
            why = "title_passed"
        reasons.append(why)
        passed_before.append(before)
    open_rows = [i for i, why in enumerate(reasons) if why is None]
    skipped = {"in_tracker": 0, "seen_before": 0, "excluded": 0, "title_passed": 0}
    for why in reasons:
        if why:
            skipped[why] += 1

    # Remember the rows Claude passed over by title, so later runs for this
    # resume type skip them. Keys only; old ones are cleared as new ones come.
    remembered: set = set()
    for (_row, pair, uk), why, before in zip(
        keyed, reasons, passed_before, strict=True
    ):
        if why != "title_passed" or before or run.track_id is None:
            continue
        mark = uk or pair
        if not (uk or all(pair)) or mark in remembered:
            continue
        remembered.add(mark)
        db.add(
            ScoutPass(
                id=uuid.uuid4(),
                user_id=user_id,
                track_id=run.track_id,
                company_key=pair[0],
                title_key=pair[1],
                url_key=uk,
            )
        )
    if remembered:
        await db.execute(
            ScoutPass.__table__.delete().where(
                ScoutPass.user_id == user_id,
                ScoutPass.created_at < _now() - timedelta(days=PASS_DAYS),
            )
        )

    # So the page can say why a search came back short: "looked at 24, 9 seen
    # before, 4 titles didn't fit". Counts only, added up across pages; a row
    # Claude sends twice (the same page again) is counted once, by a short
    # fingerprint, never its text. A page with any row not counted before is a
    # new page read; one with none (empty, or only rows from earlier pages,
    # which boards show past their last page) means the results ran out,
    # unless it's the last page sent again.
    stats = dict(run.stats or {})
    counted = set(stats.get("_rows", []))
    marks: list[str] = []
    new_page = False
    for (_row, pair, uk), why in zip(keyed, reasons, strict=True):
        if not (uk or (pair[0] and pair[1])):
            continue
        mark = hashlib.sha1((uk or f"{pair[0]}|{pair[1]}").encode()).hexdigest()[:12]
        marks.append(mark)
        if mark in counted:
            continue
        counted.add(mark)
        new_page = True
        stats["rows"] = stats.get("rows", 0) + 1
        if why:
            stats[why] = stats.get(why, 0) + 1
    # One company's openings (Local companies) aren't a results page.
    paged = c["source"] != LOCAL
    resent = bool(marks) and sorted(set(marks)) == stats.get("_last")
    ran_out = paged and not new_page and not resent
    if new_page and paged:
        stats["pages"] = stats.get("pages", 0) + 1
    if new_page:  # the last page read, to tell it apart when sent again
        stats["_last"] = sorted(set(marks))
    stats["_rows"] = sorted(counted)[-2000:]
    run.stats = stats
    await db.flush()
    progress = await _progress(db, run)
    pages = stats.get("pages", 0)
    max_pages = instr.limit(c, "pages")
    more = pages < max_pages and not ran_out
    next_page = page_url(c, pages) if more else None
    if progress["done"]:
        nxt = "Target reached: call finish_scout_run."
    elif not paged:
        nxt = (
            "Open each of these rows' postings in turn and report_job them, "
            "then call company_checked."
            if open_rows
            else "None new at this company: call company_checked."
        )
    else:
        if next_page:
            after = f"open next_page_url (page {pages + 1} of {max_pages})"
        elif more:
            after = "scroll the list for more jobs and send the next rows"
        elif ran_out:
            after = "there are no more results, so call finish_scout_run"
        else:
            after = (
                f"call finish_scout_run: that was the last of the {max_pages} "
                "pages a run reads"
            )
        nxt = (
            "Open each of these rows' postings in turn and report_job them. "
            f"Then {after}."
            if open_rows
            else f"None new on this page: {after}."
        )
    out = {
        "open": open_rows,
        "skipped": skipped,
        "pages_read": pages,
        "progress": progress,
        "next": nxt,
    }
    if next_page and not progress["done"]:
        out["next_page_url"] = next_page
    return out


def _pay_note(capture: ScoutCapture, min_pay: int | None) -> str | None:
    """The app's own pay check, on the pay the posting lists (never Claude's)."""
    top = capture.salary_max or capture.salary_min
    if not min_pay or not top:
        return None
    yearly = top * HOURS_PER_YEAR if capture.salary_period == "hourly" else top
    if yearly >= min_pay:
        return None
    return f"Pay listed up to ${yearly:,}, under your ${min_pay:,} minimum"


async def _closest_track(
    db: AsyncSession, user_id: uuid.UUID, name: str
) -> uuid.UUID | None:
    """The user's resume type with this name (any case or spacing), or None."""
    wanted = " ".join(str(name or "").split()).lower()
    if not wanted:
        return None
    for tid, tname in (
        await db.execute(
            select(ResumeTrack.id, ResumeTrack.name).where(
                ResumeTrack.user_id == user_id, ResumeTrack.kind == SCOPED
            )
        )
    ).all():
        if " ".join(tname.split()).lower() == wanted:
            return tid
    return None


async def report_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    run_id: str | None,
    url: str,
    fit_score: int,
    why_fit: str,
    gaps: str,
    resume_type: str = "",
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    if not 0 <= int(fit_score) <= 10:
        raise ValueError("fit_score must be 0-10.")
    problem = posting_problem(url)
    if not problem and run.criteria.get("source") == LOCAL and is_job_site(url):
        problem = (
            "This search only uses the companies' own sites. Skip jobs that "
            "are only on a job board."
        )
    if problem:
        return {
            "outcome": "rejected_link",
            "reason": problem,
            **await _progress(db, run),
        }
    key = url_key(url)
    c = run.criteria
    finding = await db.scalar(
        select(ScoutFinding).where(
            ScoutFinding.run_id == run.id, ScoutFinding.url_key == key
        )
    )
    if finding is not None and finding.outcome in _SEEN:
        return {
            "outcome": finding.outcome,
            "note": "Already reported in this run.",
            **await _progress(db, run),
        }
    first_report = finding is None
    if finding is None:
        finding = ScoutFinding(
            id=uuid.uuid4(),
            user_id=user_id,
            run_id=run.id,
            track_id=run.track_id,
            source=c["source"],
            url=url[:2000],
            url_key=key,
            outcome=WAITING,
            fit_score=0,
        )
        db.add(finding)
    finding.fit_score = int(fit_score)
    finding.why_fit = (why_fit or "")[:600]
    finding.gaps = (gaps or "")[:600]
    if c.get("broad"):
        finding.closest_track_id = await _closest_track(db, user_id, resume_type)

    capture = await db.scalar(
        select(ScoutCapture)
        .where(ScoutCapture.user_id == user_id, ScoutCapture.url_key == key)
        .order_by(ScoutCapture.captured_at.desc())
        .limit(1)
    )
    if capture is None:
        if not first_report:
            finding.outcome = NO_COPY
            finding.app_note = "No page copy: open this job and press Save"
            await db.flush()
            return {
                "outcome": NO_COPY,
                "note": "The page copy never arrived; it's listed for the user to "
                "save by hand. Move on to the next job.",
                **await _progress(db, run),
            }
        await db.flush()
        return {
            "outcome": WAITING,
            "next": "Stay on the posting page, wait a few seconds, then call "
            "report_job again with the same link.",
            **await _progress(db, run),
        }

    finding.company = capture.company[:255]
    finding.title = capture.title[:500]
    finding.company_key = company_key(capture.company)[:255]
    finding.title_key = title_key(capture.title)[:500]
    pair = (finding.company_key, finding.title_key)
    await db.flush()
    seen = await _seen_jobs(db, user_id, {pair}, {key}, skip_finding=finding.id)
    pay_note = _pay_note(capture, c.get("min_pay"))
    if seen:
        why = seen.get(pair) or seen.get(key)
        finding.outcome = DUPLICATE
        finding.app_note = (
            "Already in your tracker"
            if why == "in_tracker"
            else "Found by an earlier run"
        )
    elif pay_note:
        finding.outcome = BELOW_BAR
        finding.app_note = pay_note
    elif finding.fit_score < c["min_fit"]:
        finding.outcome = BELOW_BAR
        finding.app_note = f"Fit under your minimum of {c['min_fit']}"
    elif c.get("auto_save"):
        folder = await review.resolve_folder(db, user_id, c)
        await review.save_finding_job(
            db,
            user_id,
            finding,
            source=c["source"],
            track_id=review.job_track(run, finding),
            folder_id=folder.id,
            capture=capture,
        )
    else:
        # A good fit: kept for the user to tick and save (the review step).
        finding.outcome = PICKED
        finding.app_note = None
    if c.get("broad") and finding.outcome in _KEPT:
        await titles_svc.credit_fit(db, run, finding)
    await db.flush()
    progress = await _progress(db, run)
    return {
        "outcome": finding.outcome,
        "app_note": finding.app_note,
        **progress,
        "next": (
            "Target reached: call finish_scout_run."
            if progress["done"]
            else "Go on to the next new row."
        ),
    }


async def finish_run(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, note: str = ""
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    run.status = RUN_DONE
    run.finished_at = _now()
    run.note = (note or "").strip()[:500] or None
    await db.flush()
    counts = (await _counts(db, [run.id])).get(run.id, {})
    waiting = await db.scalar(
        select(func.count()).where(
            ScoutRun.user_id == user_id, ScoutRun.status == RUN_QUEUED
        )
    )
    picked, saved = counts.get(PICKED, 0), counts.get(SAVED, 0)
    if picked:
        tell = (
            f"{picked} job{'s are' if picked != 1 else ' is'} waiting in Job "
            "Enhancer (Find Jobs > Claude Scout) for them to tick and save. "
            "Don't say anything was saved."
        )
    elif saved:
        tell = f"{saved} job{'s were' if saved != 1 else ' was'} saved to My Jobs."
    else:
        tell = "nothing new fit this time."
    looked = companies.summary(run.stats)
    if looked:
        tell = f"{looked} {tell[0].upper()}{tell[1:]}"
    return {
        "status": RUN_DONE,
        "counts": RunCounts(**counts).model_dump(),
        "next": f"All done. Tell the user: {tell}"
        + (
            " Another run is queued: start a NEW chat and say the same line, so "
            "this chat's history doesn't carry over."
            if waiting
            else ""
        ),
    }


async def check_companies(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, rows: list[dict]
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    out = await companies.check(db, user_id, run, rows)
    progress = await _progress(db, run)
    if progress["done"]:
        out["next"] = "Target reached: call finish_scout_run."
    return {**out, "progress": progress}


async def company_checked(
    db: AsyncSession,
    user_id: uuid.UUID,
    run_id: str | None,
    website: str,
    result: str,
    careers_url: str | None = None,
    name: str = "",
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    out = await companies.checked(db, user_id, run, website, result, careers_url, name)
    progress = await _progress(db, run)
    if progress["done"]:
        out["next"] = "Target reached: call finish_scout_run."
    return {**out, "progress": progress}


async def set_search_titles(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, titles: list
) -> dict:
    """An "Anything I'd be good at" run: the titles Claude chose. The app keeps
    the user's overrides, leaves out titles resting after finding nothing, and
    builds the search links with the user's own filters."""
    run = await _run_for_agent(db, user_id, run_id)
    c = run.criteria
    if not c.get("broad"):
        raise ValueError(
            "This search uses its resume type's titles: open the brief's start_urls."
        )
    progress = await _progress(db, run)
    first = (
        "Open the first start URL and send the companies it lists to check_companies."
        if c["source"] == LOCAL
        else "Open the start URL and send the first page of rows to check_jobs."
    )
    stats = run.stats or {}
    started = stats.get("rows") or stats.get("_companies")
    if c.get("search_titles") and started:
        return {
            "titles": c["search_titles"],
            "dropped": [],
            "start_urls": start_urls(c),
            "note": "This run's titles are set: results are already being read.",
            "progress": progress,
            "next": "Carry on with the results you have.",
        }
    if not isinstance(titles, list):
        titles = []
    kept, dropped = await titles_svc.choose(db, run, titles)
    if not kept:
        why = ", ".join(f"{d['title']}: {d['why']}" for d in dropped) or "none sent"
        raise ValueError(f"None of these can be searched ({why}). Choose other titles.")
    run.criteria = {**c, "search_titles": kept}
    await titles_svc.record_runs(db, run, kept)
    await db.flush()
    return {
        "titles": kept,
        "dropped": dropped,
        "start_urls": start_urls(run.criteria),
        "progress": progress,
        "next": first,
    }
