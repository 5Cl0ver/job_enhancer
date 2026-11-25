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

import contextlib
import hashlib
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import HTTPException
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_profile import ApplicationProfile
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
    TOO_FAR,
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
    RunBands,
    RunCounts,
    RunFolder,
    RunHidden,
    RunLink,
    RunOut,
    RunTitle,
    RunWidened,
    place_problem,
)
from app.services import collections as col_svc
from app.services import scout_companies as companies
from app.services import scout_instructions as instr
from app.services import scout_levels as levels_svc
from app.services import scout_review as review
from app.services import scout_titles as titles_svc
from app.services import skipped_sites as sites_svc
from app.services.scout_dedupe import (
    BOARD_HOSTS,
    company_key,
    is_job_site,
    posting_problem,
    title_key,
    url_key,
)
from app.services.scout_results import band, status_of
from app.services.scout_review import SOURCE_LABEL
from app.services.scout_tracks import BROAD, SCOPED, broad_track, get_track

PLAYBOOK_VERSION = "2026.11.13"
# What Claude is told lives in app/scout/*.md and scout_instructions (the user
# can edit most of it; a run uses its own snapshot).
SOURCE_STEP_KEYS = ("google_jobs", LOCAL)
NO_RESUME = "Upload your resume first: AI Apply → Your Resume."
RUBRIC = instr.RUBRIC
MAX_ROWS_PER_CHECK = 30
# Results pages a run reads before it stops (the user can change it), and how
# many of the resume type's titles one search asks for (runs take turns).
MAX_PAGES = instr.LIMITS["search_pages"]
TITLES_PER_SEARCH = 4
HOURS_PER_YEAR = 2080
# Findings that count as "seen": a job the user has decided on or has waiting
# to decide, or that Claude already judged. A job with no page copy isn't seen;
# it can be found again.
_SEEN = (SAVED, PICKED, SKIPPED, BELOW_BAR, DUPLICATE, TOO_FAR)
# Reports of one job without a page copy before it's listed as not copied.
COPY_TRIES = 3
# A search with fewer results than this in its window is widened once, to the
# next window (research R5).
THIN = 25
WIDEN = {1: 3, 3: 7}
# Keep going (spec 021): a run whose searches are all read while it's still
# short of good fits adds more, one step at a time: remote jobs anywhere in
# the country, then a longer window, then the titles this round left out.
# It stops adding once it has looked through the "looks" limit of jobs.
KEEP_GOING = ("remote", "wider", "titles")
MORE_DAYS = 14
# LinkedIn's id for the United States (remote searches).
US_GEO_ID = "103644278"
# Outcomes the user decided on. (A duplicate points at a job already in the
# tracker, which in_tracker covers, or at an earlier finding that carries its
# own outcome.)
_DECIDED = (SAVED, PICKED, SKIPPED)
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
    new_place = "location" in updates and (updates["location"] or None) != (
        mission.location or None
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
    if new_place:  # LinkedIn's id was for the old place
        mission.linkedin_geo_id = None
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
# A place with no radius set searches this far around it.
DEFAULT_RADIUS = 25
# The distances each job board offers; a radius is rounded up to the next one
# (so a 40-mile search on LinkedIn asks for 50, never fewer miles).
BOARD_RADII = {
    "linkedin": (5, 10, 25, 50, 100),
    "ziprecruiter": (5, 10, 25, 50, 100),
    "indeed": (5, 10, 15, 25, 35, 50, 100),
}
# Jobs on one results page, per board.
PER_PAGE = {"linkedin": 25, "indeed": 10, "ziprecruiter": 20}
# The link parameters worth checking survived LinkedIn's redirect.
_CHECKED_PARAMS = (
    "keywords",
    "geoId",
    "location",
    "distance",
    "f_TPR",
    "f_E",
    "sortBy",
)


def board_radius(source: str, miles: int | None) -> int | None:
    """The distance to ask a job board for: the nearest it offers at or above
    the user's miles (the most it offers when they asked for more)."""
    if not miles:
        return None
    options = BOARD_RADII.get(source)
    if not options:
        return int(miles)
    return next((o for o in options if o >= miles), options[-1])


def _radius(c: dict) -> int | None:
    """The run's radius in miles: only around a place, for jobs you'd travel
    to; a place with no radius set gets the default."""
    if not c.get("location") or c.get("remote") == "remote_only":
        return None
    return int(c.get("radius_miles") or DEFAULT_RADIUS)


def search_titles(c: dict) -> list[str]:
    """The titles this run searches. The resume type's titles and related
    titles, each its own search, up to the "searches per run" limit; runs take
    turns when there are more (``round``). With exact titles, up to
    ``TITLES_PER_SEARCH`` share one search, as quoted phrases."""
    if c.get("broad"):  # Claude's own, set with set_search_titles
        return list(c.get("search_titles") or [])
    track = c["track"]
    seen: set[str] = set()
    titles = []
    for t in (
        list(track.get("titles") or [])
        + list(track.get("related") or [])
        + list(track.get("suggested") or [])  # Claude's, for this run only
    ):
        if t.lower() not in seen:
            seen.add(t.lower())
            titles.append(t)
    titles = titles or [track["name"]]
    group = TITLES_PER_SEARCH if track.get("exact") else instr.limit(c, "links")
    if len(titles) <= group:
        return titles
    first = (int(c.get("round") or 0) * group) % len(titles)
    return (titles[first:] + titles[:first])[:group]


def _groups(c: dict, titles: list[str]) -> list[tuple[str, str]]:
    """(label, words) for each search of these titles."""
    if c["track"].get("exact") and not c.get("broad"):
        return [(" / ".join(titles), " OR ".join(f'"{t}"' for t in titles))]
    # Each title its own search, as plain words LinkedIn matches loosely.
    return [(t, t) for t in titles]


def search_links(c: dict) -> list[dict]:
    """The searches this run makes: what each one asks for, and its link with
    the filters already set, so Claude never spends screenshots on them. The
    searches a run added to keep going (``more``, spec 021) come after."""
    if c["source"] == LOCAL:
        return [{"title": "", "url": u} for u in company_searches(c)]
    specs = [
        {"title": label, "words": words}
        for label, words in _groups(c, search_titles(c))
    ]
    specs += list(c.get("more") or [])
    # Searches widened because they were thin keep their own, longer window.
    widened = c.get("widened") or {}
    return [
        {
            "title": s["title"],
            "url": _link(
                c,
                s["words"],
                widened.get(str(i)) or s.get("days"),
                remote=bool(s.get("remote")),
            ),
        }
        for i, s in enumerate(specs)
    ]


def base_count(c: dict) -> int:
    """How many of the run's searches it started with (before keep-going ones)."""
    return len(search_links(c)) - len(c.get("more") or [])


def start_urls(c: dict) -> list[str]:
    return [link["url"] for link in search_links(c)]


def search_place(c: dict) -> str:
    """The place to search, with its state when the app knows it ("Beaverton,
    OR"): a bare town name can be another town (spec 021)."""
    return c.get("where") or c.get("location") or ""


def _google_window(days: int) -> str:
    """How Google's job search is told the window, in words it understands."""
    if days <= 1:
        return " since yesterday"
    if days <= 3:
        return " in the last 3 days"
    if days <= 7:
        return " in the last week"
    return " in the last month"


def _link(c: dict, words: str, days: int | None = None, *, remote: bool = False) -> str:
    """One search's link. ``remote``: the same search for remote jobs anywhere
    in the country, which a search around a place leaves out (spec 021)."""
    days = int(days or c["posted_within_days"])
    remote = remote or c.get("remote") == "remote_only"
    location = "" if remote else search_place(c)
    radius = None if remote else _radius(c)
    source = c["source"]
    if source == "linkedin":
        q = {"keywords": words}
        if remote:  # the whole country: a place would keep only its own jobs
            q["location"] = "United States"
            q["geoId"] = US_GEO_ID
        else:
            q["location"] = location
            if c.get("geo_id"):  # signed in, LinkedIn goes by this, not the name
                q["geoId"] = c["geo_id"]
        if radius:
            q["distance"] = str(board_radius(source, radius))
        q["f_TPR"] = f"r{days * 86400}"
        # Experience levels (spec 012).
        q["f_E"] = levels_svc.linkedin_f_e(c["track"].get("levels"))
        q["sortBy"] = "DD"
        if remote:
            q["f_WT"] = "2"
        elif c.get("remote") == "no_remote":
            q["f_WT"] = "1,3"
        return f"https://www.linkedin.com/jobs/search/?{urlencode(q)}"
    if source == "google_jobs":
        # Google's job search reads plain words: "near" a place and a window.
        if remote:
            q = f"{words} remote jobs"
        elif location:
            q = f"{words} jobs near {location}"
        else:
            q = f"{words} jobs"
        q += _google_window(days)
        # udm=8: Google's own Jobs results.
        return f"https://www.google.com/search?{urlencode({'q': q, 'udm': '8'})}"
    if source == "indeed":
        q = {"q": words, "l": "Remote" if remote else location}
        if remote:
            q["sc"] = "0kf:attr(DSQF7);"  # Indeed's own Remote filter
        q |= {"fromage": str(min(days, 14)), "sort": "date"}
        if radius:
            q["radius"] = str(board_radius(source, radius))
        return f"https://www.indeed.com/jobs?{urlencode(q)}"
    zip_days = next(d for d in (1, 5, 10, 30) if d >= days)
    q = {"search": words, "location": "Remote" if remote else location}
    q["days"] = str(zip_days)
    if remote:
        q["refine_by_location_type"] = "only_remote"
    if radius:
        q["radius"] = str(board_radius(source, radius))
    return f"https://www.ziprecruiter.com/jobs-search?{urlencode(q)}"


def page_url(c: dict, link: int, pages_read: int) -> str | None:
    """The link to the next results page of one search after ``pages_read``
    pages, so Claude opens it instead of clicking the board's page buttons.
    None where results don't come in numbered pages (Google)."""
    source = c["source"]
    urls = start_urls(c)
    if source not in PER_PAGE or link >= len(urls):
        return None
    url = urls[link]
    page = pages_read + _skip(c, link)
    if source == "ziprecruiter":
        return f"{url}&page={page + 1}"
    return f"{url}&start={page * PER_PAGE[source]}"


def _skip(c: dict, link: int) -> int:
    """Pages an added search starts past: a longer window repeats a search
    already read, whose newest jobs it would show again first (spec 021)."""
    more = c.get("more") or []
    added = link - base_count(c)
    return int(more[added].get("skip") or 0) if 0 <= added < len(more) else 0


def first_url(c: dict, link: int) -> str:
    """Where one of the run's searches starts reading."""
    if _skip(c, link):
        return page_url(c, link, 0) or search_links(c)[link]["url"]
    return search_links(c)[link]["url"]


def dropped_params(sent: str, landed: str) -> list[str]:
    """The filters a board's redirect dropped: in the link sent, not in the
    address the page landed on."""
    try:
        sent_q = dict(parse_qsl(urlsplit(sent).query))
        landed_q = dict(parse_qsl(urlsplit(landed).query))
    except ValueError:
        return []
    return [k for k in _CHECKED_PARAMS if k in sent_q and k not in landed_q]


def link_report(c: dict, stats: dict | None) -> list[dict]:
    """Each search the run read: what it asked for, how many results the board
    said it had, pages read, and filters its redirect dropped."""
    info = (stats or {}).get("_links") or {}
    if not info or not c:
        return []
    out = []
    for i, link in enumerate(search_links(c)):
        got = info.get(str(i))
        if got is None:
            continue
        out.append(
            {
                "title": link["title"],
                "total": got.get("total"),
                "pages": got.get("pages", 0),
                "dropped": got.get("dropped") or [],
            }
        )
    return out


def links_line(c: dict, stats: dict | None) -> str | None:
    """ "LinkedIn's results per search: IT Administrator 27 · …" """
    rows = [r for r in link_report(c, stats) if r["total"] is not None]
    if not rows:
        return None
    board = SOURCE_LABEL.get(c.get("source", ""), "The board")
    parts = " · ".join(f"{r['title']} {r['total']}" for r in rows[:LINE_SEARCHES])
    if len(rows) > LINE_SEARCHES:
        parts += f" · and {len(rows) - LINE_SEARCHES} more"
    return f"{board}'s results per search: {parts}."


# Searches named in the finish line (a run that kept going has many).
LINE_SEARCHES = 8


def looked_line(c: dict, stats: dict | None) -> str | None:
    """ "Looked through 180 jobs, and kept going with remote jobs anywhere in
    the country." for a run that searched job boards (spec 021)."""
    rows = int((stats or {}).get("rows", 0))
    if c.get("source") == LOCAL or not rows:
        return None
    line = f"Looked through {rows} job{'s' if rows != 1 else ''}"
    added = {m.get("step") for m in c.get("more") or []}
    shown = [STEP_WORDS[s] for s in KEEP_GOING if s in added]
    if shown:
        line += ", and kept going with " + " and ".join(shown)
    return line + "."


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
    if _looked_enough(c, s):
        return (
            f"The run looked through {rows} jobs, its limit. For more, raise "
            '"Jobs a run looks through" in Instructions › Limits.'
        )
    days = c.get("posted_within_days", 7)
    if "wider" in (c.get("steps") or []):
        days = max(days, MORE_DAYS)  # it already searched the past 14 days
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
    totals = [r["total"] for r in link_report(c, s) if r["total"] is not None]
    if totals and sum(totals) < 30:
        return (
            f"The searches themselves found only {sum(totals)} jobs. For more, add "
            "related titles to the resume type, pick a bigger radius"
            + (f", or {widen}." if widen else ".")
        )
    budget = instr.limit(c, "search_pages") * max(1, base_count(c))
    ran_out = run.status == RUN_DONE and s.get("pages", budget) < budget
    if ran_out and (widen or (radius and radius < 100)):
        more = [w for w in (widen, "pick a bigger radius" if radius else "") if w]
        return f"The search ran out of results. For more, {' or '.join(more)}."
    return None


# Kinds of local employers that hire IT staff. A "Local companies" search uses
# them only when the user's titles give fewer than three searches.
EMPLOYER_KINDS = (
    "software and IT companies",
    "hospitals and clinics",
    "banks and credit unions",
    "school districts and colleges",
    "manufacturing companies",
    "engineering firms",
    "city and county government offices",
    "company headquarters",
    "largest employers",
)
# Google searches a "Local companies" run makes.
COMPANY_SEARCHES = 3
# Keeps job boards out of the plain results.
_NOT_BOARDS = "-indeed -linkedin -glassdoor -ziprecruiter"


def company_searches(c: dict) -> list[str]:
    """Google searches for businesses near the user that hire for their titles:
    three a run, taken in turn (``round``) so runs reach different ones. Kinds
    of employer fill in when the titles give fewer than three."""
    track = c["track"]
    if c.get("broad"):  # the titles Claude chose for this run
        roles = [f"companies that hire {t}" for t in search_titles(c)]
    else:
        roles = [f"{track['name']} companies"] + [
            f"companies that hire {t}"
            for t in list(track.get("titles") or []) + list(track.get("related") or [])
        ]
    queries: list[str] = []
    for r in roles:
        if r.lower() not in {q.lower() for q in queries}:
            queries.append(r)
    n = int(c.get("round") or 0)
    if c.get("broad"):  # Claude chooses new titles each run
        queries = queries[:COMPANY_SEARCHES]
    elif len(queries) > COMPANY_SEARCHES:
        first = (COMPANY_SEARCHES * n) % len(queries)
        queries = (queries[first:] + queries[:first])[:COMPANY_SEARCHES]
    else:
        # Few titles: they take turns in all but one search, and kinds of
        # employer fill the rest, so each run still reaches new businesses.
        take = min(len(queries), COMPANY_SEARCHES - 1)
        first = (take * n) % len(queries) if queries else 0
        queries = (queries[first:] + queries[:first])[:take]
    need = COMPANY_SEARCHES - len(queries)
    kinds = len(EMPLOYER_KINDS)
    queries += [EMPLOYER_KINDS[(need * n + i) % kinds] for i in range(need)]
    return _google(queries, c)


def _google(queries: list[str], c: dict) -> list[str]:
    """Each query as a Google search near the user's place, job boards left out."""
    place = search_place(c)
    near = f" near {place}" if place else ""
    return [
        f"https://www.google.com/search?{urlencode({'q': f'{q}{near} {_NOT_BOARDS}'})}"
        for q in queries
    ]


async def _with_state(
    db: AsyncSession, user_id: uuid.UUID, location: str | None
) -> str | None:
    """ "Beaverton" → "Beaverton, OR" when it's the town in the user's
    application profile; a place that already names more, or another town,
    as typed."""
    town = " ".join((location or "").split())
    if not town or "," in town:
        return location
    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user_id)
    )
    city = " ".join((profile.city or "").split()) if profile else ""
    state = " ".join((profile.state or "").split()) if profile else ""
    if state and city.casefold() == town.casefold():
        return f"{town}, {state}"[:120]
    return location


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
        # The same place with its state, for the search links (spec 021).
        "where": await _with_state(db, user_id, mission.location),
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
        # LinkedIn's id for the place, once a run learned it.
        "geo_id": mission.linkedin_geo_id,
        "track": {
            "name": track.name,
            "titles": list(track.target_titles or []),
            "related": list(track.related_titles or []),
            "exact": bool(track.exact_titles),
            "skills": list(track.key_skills or []),
            "skip": skip,
            "notes": track.notes,
            "levels": levels_svc.clean_levels(track.levels),
            "years": track.years,
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


async def _bands(db: AsyncSession, runs: Sequence[ScoutRun]) -> dict:
    """Per run, the jobs it found in each Results group (spec 012). Repeats of
    jobs already found or tracked, and jobs too far away, are left out."""
    bars = {r.id: int((r.criteria or {}).get("min_fit", 6)) for r in runs}
    rows = await db.execute(
        select(
            ScoutFinding.run_id,
            ScoutFinding.fit_score,
            ScoutFinding.outcome,
            ScoutFinding.saved_job_id,
        ).where(ScoutFinding.run_id.in_(list(bars)))
    )
    out: dict[uuid.UUID, dict[str, int]] = {}
    for run_id, fit, outcome, saved_job_id in rows.all():
        group = out.setdefault(run_id, {})
        if status_of(outcome, saved_job_id) == "hidden":
            key = "too_far" if outcome == TOO_FAR else "repeats"
            group[key] = group.get(key, 0) + 1
            continue
        b = band(fit, bars[run_id])
        group[b] = group.get(b, 0) + 1
    return out


def looking_for(c: dict) -> dict:
    """What a run looked for, as it was at Start, for the page's plain line."""
    track = c.get("track") or {}
    return {
        "source": c.get("source"),
        "track": track.get("name"),
        "broad": bool(c.get("broad")),
        "levels": levels_svc.clean_levels(track.get("levels")),
        "location": c.get("location"),
        "radius_miles": _radius(c),
        "remote": c.get("remote", "any"),
        "days": c.get("posted_within_days"),
        "min_fit": c.get("min_fit"),
        "job_count": c.get("job_count"),
    }


async def runs_out(
    db: AsyncSession, runs: Sequence[ScoutRun], *, with_findings: bool = False
) -> list[RunOut]:
    if not runs:
        return []
    counts = await _counts(db, [r.id for r in runs])
    bands = await _bands(db, runs)
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
        finished = r.status in (RUN_DONE, RUN_STOPPED)
        info = (r.stats or {}).get("_links") or {}
        names = [link["title"] for link in search_links(c)] if c else []
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
                links=[RunLink(**x) for x in link_report(c, r.stats)],
                instructions=c.get("instructions"),
                broad=bool(c.get("broad")),
                titles=[
                    RunTitle(title=t, good_fits=fits_by_title.get((r.id, t), 0))
                    for t in c.get("search_titles") or []
                ],
                findings=findings.get(r.id, []),
                bands=RunBands(**bands.get(r.id, {})),
                hidden=RunHidden(**bands.get(r.id, {})),
                not_copied=run_counts.no_copy
                + (run_counts.waiting_for_copy if finished else 0),
                suggested_titles=list((c.get("track") or {}).get("suggested") or []),
                widened=[
                    RunWidened(title=names[int(i)], days=int(v["widened_days"]))
                    for i, v in sorted(info.items(), key=lambda kv: int(kv[0]))
                    if isinstance(v, dict)
                    and v.get("widened_days")
                    and int(i) < len(names)
                ],
                looking_for=looking_for(c) if c else None,
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
        extra["max_pages"] = instr.limit(c, "search_pages")  # per search
        extra["searches"] = [link["title"] for link in search_links(c)]
    if (
        c["source"] == "linkedin"
        and c.get("location")
        and c.get("remote") != ("remote_only")
    ):
        radius = _radius(c)
        extra["place"] = {
            "location": search_place(c),
            "geo_id": c.get("geo_id"),
            "radius_miles": radius,
            "linkedin_distance": board_radius("linkedin", radius),
        }
    track = c["track"]
    extra["level_rule"] = levels_svc.level_rule(track.get("levels"), track.get("years"))
    area = area_rule(c)
    if area:
        extra["area"] = area
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
            "Visit the recheck companies first, if the run picks any. Then open"
            if preview
            else "Visit the recheck companies first. Then open"
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
            max_titles=titles_svc.max_titles(c),
            titles_tried=await titles_svc.for_brief(db, run),
            always=ov["always"],
            never=ov["never"],
            avoid=ov["avoid"],
            resume_types=await _resume_types(db, user_id),
        )
    done_searching = False
    so_far = run.stats or {}
    if not local and not choosing and "_link" in so_far:
        links = search_links(c)
        at, at_pages = int(so_far["_link"]), int(so_far.get("_link_pages", 0))
        if at < len(links):
            resume = (page_url(c, at, at_pages) if at_pages else None) or first_url(
                c, at
            )
            extra["resume_url"] = resume
            first = (
                f"Carry on where the run was: open resume_url (search {at + 1} of "
                f"{len(links)}, {links[at]['title']}) and send its rows to check_jobs."
            )
        else:
            done_searching = True
            first = "Every search has been read: call finish_scout_run."
    suggest = suggest_count(c, run.stats) if ready else 0
    if suggest:
        extra["suggest_titles"] = suggest
    if suggest and not done_searching:
        first = (
            f"Call get_master_profile, choose up to {suggest} more job titles at "
            f"the user's levels ({levels_svc.levels_label(track.get('levels'))}) "
            "that their resume fits and the resume type's titles don't cover, and "
            "call set_search_titles: it gives you the start URLs. Score every job "
            "against the resume."
        )
    elif choosing:
        first = (
            "Call get_master_profile, choose up to "
            f"{titles_svc.max_titles(c)} job titles the user would be good at (see "
            "broad_steps), then call set_search_titles: it gives you the start URLs."
        )
    elif ready and not done_searching:
        first = (
            "Call get_master_profile once and score every job against the resume. "
            f"Then {first[0].lower()}{first[1:]}"
        )
    rubric = instr.rubric_for(c)
    # The user's sites to skip (spec 024), read live: one line, only when set.
    skip_sites = await sites_svc.hosts(db, user_id)
    if skip_sites:
        extra["skip_sites"] = skip_sites
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


def area_rule(c: dict) -> dict | None:
    """Where jobs count for this search, so Claude can send in_area with each
    job (spec 012). None when the search has no place."""
    location = search_place(c)
    remote = c.get("remote", "any")
    if not location or remote == "remote_only":
        return None
    radius = _radius(c)
    remote_ok = remote == "any"
    rule = (
        f"A job counts when it is in or within about {radius} miles of {location}"
        + (", or fully remote" if remote_ok else "")
        + ". Send in_area false for any other job: the app marks it Too far."
    )
    return {
        "location": location,
        "radius_miles": radius,
        "remote_ok": remote_ok,
        "rule": rule,
    }


MAX_SUGGESTED = 4


def suggest_count(c: dict, stats: dict | None) -> int:
    """How many related titles Claude may add to this run (research R6): only
    for a resume type with none of its own, on a job-board search, before
    results are read."""
    if c.get("broad") or c.get("source") == LOCAL:
        return 0
    track = c.get("track") or {}
    if track.get("related") or track.get("suggested") or track.get("exact"):
        return 0
    s = stats or {}
    if s.get("rows") or "_link" in s:
        return 0
    return MAX_SUGGESTED


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
    track: ResumeTrack | None = None,
    mission_id: uuid.UUID | None = None,
) -> dict[tuple[str, str] | str, str]:
    """Which of these (company_key, title_key) pairs and url keys are already
    known, and why. Queries only rows with matching titles or links, so the
    cost doesn't grow with the size of the tracker.

    A job the user decided on (picked, saved, passed on, already had) is seen
    for good. A job scored below the bar is seen only by runs of the same
    resume type, and only until that type's titles, skills or rules change
    (spec 011): a low score for one kind of role says nothing about another."""
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
        low = [ScoutFinding.outcome == BELOW_BAR]
        if track is not None:
            low.append(ScoutFinding.track_id == track.id)
            if track.rules_changed_at is not None:
                low.append(ScoutFinding.created_at >= track.rules_changed_at)
        else:
            low.append(false())
        # Too far is about one search's place (spec 012): it hides a job only
        # from later runs of that same search.
        far = and_(
            ScoutFinding.outcome == TOO_FAR,
            ScoutFinding.run_id.in_(
                select(ScoutRun.id).where(ScoutRun.mission_id == mission_id)
            )
            if mission_id is not None
            else false(),
        )
        query = select(
            ScoutFinding.company_key, ScoutFinding.title_key, ScoutFinding.url_key
        ).where(
            ScoutFinding.user_id == user_id,
            or_(ScoutFinding.outcome.in_(_DECIDED), and_(*low), far),
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
    db: AsyncSession,
    user_id: uuid.UUID,
    run_id: str | None,
    rows: list[dict],
    total_results: int | None = None,
    page_url_seen: str | None = None,
    place_fixed: bool = False,
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
    track = await db.get(ResumeTrack, run.track_id) if run.track_id else None
    seen = await _seen_jobs(
        db, user_id, pairs, urls, track=track, mission_id=run.mission_id
    )
    # Rows passed over by title before (an earlier run, or an earlier page).
    passed = await _passed(db, user_id, run.track_id, pairs, urls)
    # The user's sites to skip (spec 024): never offered, whatever else.
    skip_sites = await sites_svc.hosts(db, user_id)

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
        if not why and sites_svc.skipped_by(str(row.get("url") or ""), skip_sites):
            why = "skipped_site"
        if not why and not _fits(row):
            why = "title_passed"
        reasons.append(why)
        passed_before.append(before)
    open_rows = [i for i, why in enumerate(reasons) if why is None]
    skipped = {"in_tracker": 0, "seen_before": 0, "excluded": 0, "title_passed": 0}
    if skip_sites:
        skipped["skipped_site"] = 0
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
    link = int(stats.get("_link", 0))
    link_pages = int(stats.get("_link_pages", 0))
    page_marks = sorted(set(marks))
    last = stats.get("_last")
    if not isinstance(last, dict):  # runs from before searches were split
        last = {"marks": last, "link": link}
    # A call that repeats one already answered (a retry, or a new chat sending
    # the last page again) changes nothing and gets the same answer. Rows the
    # next search shares with the last page are told apart: by the address
    # Claude landed on, or by being sent a second time.
    found = _links_of(c, page_url_seen) if paged and page_url_seen else []
    seen_link = link if link in found else (found[0] if found else None)
    # Searches a run added share their words with the first ones: an address
    # that fits more than one can't tell a resend from the next search.
    sure = len(found) == 1
    resent = False
    if seen_link is not None and seen_link < link:
        resent = True  # a page of a search already done
    elif (
        page_marks
        and last.get("marks") == page_marks
        # The first page of a search just widened often shows the same rows:
        # that's the widened search with nothing new, not a resend.
        and not (link_pages == 0 and _widened_now(stats, link))
    ):
        moved_on = last.get("link") != link
        repeats = int(last.get("repeats", 0)) + 1
        resent = not (moved_on and ((seen_link == link and sure) or repeats >= 2))
        last = {**last, "repeats": repeats}
        stats["_last"] = last
    if resent and last.get("answer"):
        run.stats = {**stats, "_rows": sorted(counted)[-2000:]}
        await db.flush()
        progress = await _progress(db, run)
        answer = {**last["answer"], "progress": progress}
        if progress["done"]:
            answer.pop("next_page_url", None)
            answer["next"] = "Target reached: call finish_scout_run."
        return answer
    ran_out = paged and not new_page and not resent
    stats["_rows"] = sorted(counted)[-2000:]

    # Which search this page belongs to, and where Claude goes next: more pages
    # of this search, the next search, or done (spec 011).
    nxt_url: str | None = None
    note = ""
    widened_to: int | None = None
    added: dict | None = None
    looked_enough = False
    read_on = link  # the search this page was read on
    if paged:
        # Only a page of the run's own searches around its place: an added
        # remote search shows the whole country (spec 021).
        local_search = link < base_count(c) and c.get("remote") != "remote_only"
        if place_fixed and page_url_seen and c["source"] == "linkedin" and local_search:
            geo = _geo_id(page_url_seen)
            geo = None if geo == US_GEO_ID else geo
            mission = (
                await db.get(ScoutMission, run.mission_id) if run.mission_id else None
            )
            # Only for the place this run searches: the user may have changed it.
            same_place = (
                mission is not None
                and mission.user_id == user_id
                and (mission.location or None) == (c.get("location") or None)
            )
            if geo and same_place:  # LinkedIn's id for the place, kept for later runs
                c = {**c, "geo_id": geo}
                run.criteria = c
                mission.linkedin_geo_id = geo
                note = " The place is saved for later runs."
        links = search_links(c)
        per_search = instr.limit(c, "search_pages")
        all_links = dict(stats.get("_links") or {})
        info = dict(all_links.get(str(link)) or {})
        if total_results is not None and "total" not in info:
            with contextlib.suppress(TypeError, ValueError):
                info["total"] = max(0, int(total_results))
        if page_url_seen and "dropped" not in info and link < len(links):
            info["dropped"] = dropped_params(links[link]["url"], page_url_seen)
        if new_page:
            stats["pages"] = stats.get("pages", 0) + 1
            link_pages += 1
            info["pages"] = link_pages
        all_links[str(link)] = info
        stats["_links"] = all_links
        total = info.get("total")
        per_page = PER_PAGE.get(c["source"], 10)
        link_done = (
            ran_out
            or link_pages >= per_search
            or (total is not None and (link_pages + _skip(c, link)) * per_page >= total)
        )
        widened_to = _widen_to(c, link, info) if link_done else None
        if widened_to:
            # A thin search: the same search again over a longer window, once.
            c = {**c, "widened": {**(c.get("widened") or {}), str(link): widened_to}}
            run.criteria = c
            info["base_total"] = info.pop("total", None)
            info["widened_days"] = widened_to
            all_links[str(link)] = info
            link_pages = 0
            links = search_links(c)
            nxt_url = first_url(c, link)
        elif link_done:
            link, link_pages = link + 1, 0
            if link >= len(links) and not (await _progress(db, run))["done"]:
                # Every search read and still short: keep going (spec 021).
                added = _keep_going(c, stats)
                if added:
                    c = {
                        **c,
                        "more": [*(c.get("more") or []), *added["more"]],
                        "steps": added["steps"],
                    }
                    run.criteria = c
                    links = search_links(c)
                else:
                    looked_enough = _looked_enough(c, stats)
            elif base_count(c) <= link < len(links) and _looked_enough(c, stats):
                # Looked through enough: none of the rest of the added searches.
                link, looked_enough = len(links), True
            nxt_url = first_url(c, link) if link < len(links) else None
        else:
            nxt_url = page_url(c, link, link_pages)
        stats["_link"], stats["_link_pages"] = link, link_pages
    run.stats = stats
    await db.flush()
    progress = await _progress(db, run)
    pages = stats.get("pages", 0)
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
        links = search_links(c)
        link = stats["_link"]
        if link >= len(links) and looked_enough:
            after = (
                f"call finish_scout_run: the run has looked through "
                f"{stats.get('rows', 0)} jobs, its limit"
            )
        elif link >= len(links):
            after = (
                "there are no more results, so call finish_scout_run"
                if ran_out and len(links) == 1
                else "call finish_scout_run: that was the last search"
            )
        elif added and stats["_link_pages"] == 0:
            after = (
                "keep going: the run is still short of good fits, so the app "
                f"added {len(added['more'])} more searches "
                f"({STEP_WORDS[added['step']]}). Open next_page_url: "
                f"{links[link]['title']} ({link + 1} of {len(links)})"
            )
        elif widened_to:
            after = (
                f"open next_page_url: the same search, {links[link]['title']}, "
                f"widened to the past {widened_to} days because it had few results"
            )
        elif stats["_link_pages"] == 0 and link > 0:
            after = (
                f"open next_page_url: the next search, {links[link]['title']} "
                f"({link + 1} of {len(links)})"
            )
        elif nxt_url:
            after = (
                f"open next_page_url (page {stats['_link_pages'] + 1} of "
                f"{instr.limit(c, 'search_pages')} of this search)"
            )
        else:
            after = "scroll the list for more jobs and send the next rows"
        nxt = (
            "Open each of these rows' postings in turn and report_job them. "
            f"Then {after}."
            if open_rows
            else f"None new on this page: {after}."
        ) + note
    out = {
        "open": open_rows,
        "skipped": skipped,
        "pages_read": pages,
        "progress": progress,
        "next": nxt,
    }
    if nxt_url and not progress["done"]:
        out["next_page_url"] = nxt_url
    if paged and (new_page or ran_out):
        saved = {k: v for k, v in out.items() if k != "progress"}
        run.stats = {
            **run.stats,
            "_last": {"marks": page_marks, "link": read_on, "answer": saved},
        }
        await db.flush()
    return out


def _widened_now(stats: dict, link: int) -> bool:
    info = (stats.get("_links") or {}).get(str(link)) or {}
    return bool(info.get("widened_days")) and "total" not in info


def _widen_to(c: dict, link: int, info: dict) -> int | None:
    """The longer window to search again when a search had fewer than ``THIN``
    results (research R5), or None: once per search, job boards and Google."""
    if c["source"] == LOCAL or info.get("widened_days"):
        return None
    total = info.get("total")
    if total is None or total >= THIN:
        return None
    return WIDEN.get(_days_at(c, link))


def _days_at(c: dict, link: int) -> int:
    """The window one of the run's searches asks for, in days."""
    widened = (c.get("widened") or {}).get(str(link))
    more = c.get("more") or []
    added = link - (len(search_links(c)) - len(more))
    own = more[added].get("days") if 0 <= added < len(more) else None
    return int(widened or own or c["posted_within_days"])


# What each keep-going step adds, for Claude's next line.
STEP_WORDS = {
    "remote": "remote jobs anywhere in the country",
    "wider": f"the past {MORE_DAYS} days",
    "titles": "titles this run had left out",
}


def _pages_read(c: dict, stats: dict, link: int) -> int:
    """Whole results pages one search has read, counting only the results
    there were (a search of 30 read in 2 pages of 25 read 1 whole page)."""
    per_page = PER_PAGE.get(c["source"])
    info = (stats.get("_links") or {}).get(str(link)) or {}
    if not per_page or not info.get("pages"):
        return 0
    read = int(info["pages"]) * per_page
    total = info.get("total")
    if isinstance(total, int):
        read = min(read, total)
    return read // per_page


def _looked_enough(c: dict, stats: dict) -> bool:
    return int(stats.get("rows", 0)) >= instr.limit(c, "looks")


def _left_out(c: dict) -> list[str]:
    """A resume type's titles this round's searches didn't ask for (runs take
    turns when there are more than fit), up to one run's worth."""
    if c.get("broad"):
        return []
    track = c["track"]
    asked = {t.lower() for t in search_titles(c)}
    rest: list[str] = []
    for t in (
        list(track.get("titles") or [])
        + list(track.get("related") or [])
        + list(track.get("suggested") or [])
    ):
        if t.lower() not in asked and t.lower() not in {r.lower() for r in rest}:
            rest.append(t)
    group = TITLES_PER_SEARCH if track.get("exact") else instr.limit(c, "links")
    return rest[:group]


def _keep_going(c: dict, stats: dict) -> dict | None:
    """The next step for a run whose searches are all read while it's still
    short of good fits (spec 021): the searches it adds, or None when there's
    nothing left to add or it has looked through enough jobs."""
    if c["source"] == LOCAL or _looked_enough(c, stats):
        return None
    taken = list(c.get("steps") or [])
    groups = _groups(c, search_titles(c))
    remote_too = "remote" in taken
    for step in KEEP_GOING:
        if step in taken:
            continue
        taken.append(step)
        more: list[dict] = []
        if step == "remote":
            if c.get("remote", "any") == "any" and c.get("location"):
                remote_too = True
                more = [
                    {"title": f"{label} (remote)", "words": words, "remote": True}
                    for label, words in groups
                ]
        elif step == "wider":
            if int(c["posted_within_days"]) < MORE_DAYS:
                # Each search again over the longer window, starting past the
                # pages already read: the newest jobs come first again.
                base = len(groups)
                remote_at = [
                    base + i
                    for i, m in enumerate(c.get("more") or [])
                    if m.get("step") == "remote"
                ]
                more = [
                    {
                        "title": f"{label} (past {MORE_DAYS} days)",
                        "words": words,
                        "skip": _pages_read(c, stats, i),
                    }
                    for i, (label, words) in enumerate(groups)
                ]
                if remote_too:
                    more += [
                        {
                            "title": f"{label} (remote, past {MORE_DAYS} days)",
                            "words": words,
                            "remote": True,
                            "skip": _pages_read(c, stats, at),
                        }
                        for (label, words), at in zip(groups, remote_at, strict=False)
                    ]
                more = [{**m, "days": MORE_DAYS} for m in more]
        else:
            rest = _groups(c, _left_out(c)) if _left_out(c) else []
            more = [{"title": label, "words": words} for label, words in rest]
            if remote_too:
                more += [
                    {"title": f"{label} (remote)", "words": words, "remote": True}
                    for label, words in rest
                ]
        if more:
            more = [{**m, "step": step} for m in more]
            return {"step": step, "steps": taken, "more": more}
    return None


def _link_of(c: dict, url: str, at: int | None = None) -> int | None:
    """Which of the run's searches an address is a page of, by the words it
    searched for (None when it can't tell). Searches a run added to keep going
    share their words with the first ones: the one it's on (``at``) wins."""
    found = _links_of(c, url)
    if at in found:
        return at
    return found[0] if found else None


def _links_of(c: dict, url: str) -> list[int]:
    """Every one of the run's searches an address could be a page of, by the
    words it searched for."""
    key = {"linkedin": "keywords", "indeed": "q", "ziprecruiter": "search"}.get(
        c["source"], "q"
    )

    def words(u: str) -> str | None:
        try:
            value = dict(parse_qsl(urlsplit(u).query)).get(key)
        except ValueError:
            return None
        return " ".join(value.split()).casefold() if value else None

    landed = words(url)
    if not landed:
        return []
    return [i for i, link in enumerate(search_links(c)) if words(link["url"]) == landed]


def _geo_id(url: str) -> str | None:
    try:
        geo = dict(parse_qsl(urlsplit(url).query)).get("geoId", "")
    except ValueError:
        return None
    return geo if geo.isascii() and geo.isdigit() and len(geo) <= 20 else None


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
    facts: dict | None = None,
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    if not 0 <= int(fit_score) <= 10:
        raise ValueError("fit_score must be 0-10.")
    facts = clean_facts(facts)
    problem = posting_problem(url)
    if not problem and run.criteria.get("source") == LOCAL and is_job_site(url):
        problem = (
            "This search only uses the companies' own sites. Skip jobs that "
            "are only on a job board."
        )
    if not problem:
        site = sites_svc.skipped_by(url, await sites_svc.hosts(db, user_id))
        if site:
            problem = sites_svc.refusal(site)
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
            facts_from="claude",  # until the page copy arrives
            created_at=_now(),
        )
        db.add(finding)
    _apply_facts(finding, facts)
    track_c = c["track"]
    finding.claude_fit = int(fit_score)
    finding.fit_score, level_note = levels_svc.cap(
        int(fit_score),
        int(c["min_fit"]),
        track_c.get("levels"),
        track_c.get("years"),
        finding.level,
        finding.years_asked,
    )
    finding.why_fit = (why_fit or "")[:600]
    finding.gaps = (gaps or "")[:600]
    if c.get("broad"):
        finding.closest_track_id = await _closest_track(db, user_id, resume_type)
    if finding.in_area is False and area_rule(c):
        # Outside the search's area: remembered, never counted (spec 012).
        finding.outcome = TOO_FAR
        finding.app_note = f"Too far: outside {area_rule(c)['location']}"[:200]
        await db.flush()
        return {
            "outcome": TOO_FAR,
            "note": "Too far: not counted. Go on to the next new row.",
            **await _progress(db, run),
        }

    capture = await db.scalar(
        select(ScoutCapture)
        .where(ScoutCapture.user_id == user_id, ScoutCapture.url_key == key)
        .order_by(ScoutCapture.captured_at.desc())
        .limit(1)
    )
    if capture is None:
        stats = dict(run.stats or {})
        tries = dict(stats.get("_tries") or {})
        tries[key] = int(tries.get(key, 0)) + 1
        stats["_tries"] = dict(list(tries.items())[-200:])
        run.stats = stats
        if tries[key] >= COPY_TRIES or finding.outcome == NO_COPY:
            finding.outcome = NO_COPY
            finding.app_note = level_note or "Not copied: open it and press Save"
            await db.flush()
            return {
                "outcome": NO_COPY,
                "note": "The page copy never arrived. The job is listed for the "
                "user with the facts you sent; they can save it by hand. Move on "
                "to the next job.",
                **await _progress(db, run),
            }
        await db.flush()
        return {
            "outcome": WAITING,
            "next": "Stay on the posting page and scroll it once so it finishes "
            "loading, wait about 10 seconds, then call report_job again with the "
            "same link and the same facts.",
            **await _progress(db, run),
        }

    finding.facts_from = "copy"
    if capture.location:
        finding.location = capture.location[:120]
    finding.company = capture.company[:255]
    finding.title = capture.title[:500]
    finding.company_key = company_key(capture.company)[:255]
    finding.title_key = title_key(capture.title)[:500]
    pair = (finding.company_key, finding.title_key)
    await db.flush()
    track = await db.get(ResumeTrack, run.track_id) if run.track_id else None
    seen = await _seen_jobs(
        db,
        user_id,
        {pair},
        {key},
        skip_finding=finding.id,
        track=track,
        mission_id=run.mission_id,
    )
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
        finding.app_note = level_note or f"Fit under your minimum of {c['min_fit']}"
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
        **({"note": level_note} if level_note else {}),
        **progress,
        "next": (
            "Target reached: call finish_scout_run."
            if progress["done"]
            else "Go on to the next new row."
        ),
    }


# Short facts Claude may send with a job (spec 012): never the job text.
FACT_LIMITS = {"title": 200, "company": 120, "location": 120, "posted": 40}


def clean_facts(facts: dict | None) -> dict:
    """Claude's facts, trimmed and cut to their lengths; unknown ones dropped."""
    facts = facts if isinstance(facts, dict) else {}
    out: dict = {}
    for name, limit in FACT_LIMITS.items():
        value = " ".join(str(facts.get(name) or "").split())[:limit]
        if value:
            out[name] = value
    level = levels_svc.clean_level(facts.get("level"))
    if level:
        out["level"] = level
    with contextlib.suppress(TypeError, ValueError):
        years = int(facts.get("years_asked"))
        if 0 <= years <= 30:
            out["years_asked"] = years
    in_area = facts.get("in_area")
    if isinstance(in_area, str):
        in_area = {"true": True, "false": False}.get(in_area.strip().lower())
    if isinstance(in_area, bool):
        out["in_area"] = in_area
    return out


def _apply_facts(finding: ScoutFinding, facts: dict) -> None:
    """Keep Claude's facts on the finding. The page copy's title and company,
    once there, win: Claude's only fill in while there's no copy."""
    for name in ("location", "level", "years_asked", "posted", "in_area"):
        if name in facts:
            setattr(finding, name, facts[name])
    if finding.facts_from != "copy" or not finding.title:
        if facts.get("title"):
            finding.title = facts["title"]
            finding.facts_from = "claude"
        if facts.get("company"):
            finding.company = facts["company"]
            finding.facts_from = "claude"


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
    looked_through = looked_line(run.criteria or {}, run.stats)
    if looked_through:
        tell = f"{tell} {looked_through}"
    per_search = links_line(run.criteria or {}, run.stats)
    if per_search:
        tell = f"{tell} {per_search}"
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
    openings: list | None = None,
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    out = await companies.checked(
        db, user_id, run, website, result, careers_url, name, openings
    )
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
        return await _suggest_titles(db, run, titles)
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


async def _suggest_titles(db: AsyncSession, run: ScoutRun, titles) -> dict:
    """A resume type with no related titles of its own: up to
    ``MAX_SUGGESTED`` more titles Claude chose from the resume, for this run
    only (research R6). Titles above the user's levels are left out."""
    c = run.criteria
    allowed = suggest_count(c, run.stats)
    if not allowed:
        raise ValueError(
            "This search uses its resume type's titles: open the brief's start_urls."
        )
    track = c["track"]
    senior_ok = "senior" in levels_svc.clean_levels(track.get("levels"))
    have = {t.lower() for t in list(track.get("titles") or []) + [track["name"]]}
    kept: list[str] = []
    dropped: list[dict] = []
    for raw in titles if isinstance(titles, list) else []:
        title = " ".join(str(raw or "").split())[:100]
        if not title:
            continue
        if title.lower() in have or title.lower() in {k.lower() for k in kept}:
            dropped.append({"title": title, "why": "already searched"})
        elif not senior_ok and levels_svc.senior_title(title):
            dropped.append({"title": title, "why": "above the user's levels"})
        elif len(kept) >= allowed:
            dropped.append({"title": title, "why": f"only {allowed} can be added"})
        else:
            kept.append(title)
    run.criteria = {**c, "track": {**track, "suggested": kept}}
    await db.flush()
    return {
        "titles": kept,
        "dropped": dropped,
        "start_urls": start_urls(run.criteria),
        "searches": [link["title"] for link in search_links(run.criteria)],
        "progress": await _progress(db, run),
        "next": "Open the first start URL and send the first page of rows to "
        "check_jobs.",
    }
