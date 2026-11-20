"""Claude Scout: saved searches, runs, and the tools Claude in Chrome calls.

The app is the memory and the planner; each chat with Claude stays small
(research R8):

- ``brief`` hands out short rules, the resume type and a ready-made search URL.
  It never sends lists of saved jobs or past findings.
- ``check_jobs`` answers "which of these rows are new?" for one results page.
- ``report_job`` takes a link plus Claude's opinion. The job saved is the exact
  page copy the Job Catcher extension captured (``record_capture``); nothing in
  it comes from Claude (research R9).

Functions Claude reaches through the connector raise ``ValueError`` with a
message Claude can act on; the page's REST functions raise ``HTTPException``.
"""

import hashlib
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.job_listing import JobListing
from app.models.resume_track import ResumeTrack
from app.models.saved_job import SavedJob
from app.models.scout import (
    BELOW_BAR,
    DUPLICATE,
    NO_COPY,
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
)
from app.services import collections as col_svc
from app.services import scout_review as review
from app.services.scout_dedupe import (
    company_key,
    posting_problem,
    title_key,
    url_key,
)
from app.services.scout_review import SOURCE_LABEL
from app.services.scout_tracks import get_track

PLAYBOOK_VERSION = "2026.11.3"
PLAYBOOK = (Path(__file__).parent.parent / "scout" / "playbook.md").read_text(
    encoding="utf-8"
)
RUBRIC = {
    "skills": 4,
    "experience": 2,
    "title_level": 2,
    "recency": 1,
    "pay_location": 1,
}
MAX_ROWS_PER_CHECK = 30
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
    track = await get_track(db, data.track_id, user_id)
    if data.collection_id is not None:
        await col_svc.get_collection(db, data.collection_id, user_id)
    values = data.model_dump()
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
    if updates.get("track_id") is not None:
        await get_track(db, updates["track_id"], user_id)
    if updates.get("collection_id") is not None:
        await col_svc.get_collection(db, updates["collection_id"], user_id)
    old_track = await get_track(db, mission.track_id, user_id)
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
        ):
            continue  # required fields: null means "leave as is"
        setattr(mission, key, value)
    renamed = "name" in updates and updates["name"]
    if not renamed and (auto_named or "name" in updates):
        track = await get_track(db, mission.track_id, user_id)
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
    tracks = dict(
        (
            await db.execute(
                select(ResumeTrack.id, ResumeTrack.name).where(
                    ResumeTrack.user_id == user_id
                )
            )
        ).all()
    )
    out = []
    for m in missions:
        item = MissionOut.model_validate(m)
        if m.collection_id not in names:  # the chosen collection is gone
            item.collection_id = None
        item.collection_name = names.get(m.collection_id) or review.default_folder_name(
            {"track": {"name": tracks.get(m.track_id, "")}}
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
def start_urls(c: dict) -> list[str]:
    """The search page Claude opens, with the filters already set, so it never
    spends screenshots clicking through them."""
    titles = c["track"]["titles"][:4] or [c["track"]["name"]]
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


async def queue_run(
    db: AsyncSession, mission_id: uuid.UUID, user_id: uuid.UUID
) -> ScoutRun:
    mission = await get_mission(db, mission_id, user_id)
    track = await get_track(db, mission.track_id, user_id)
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
        "track": {
            "name": track.name,
            "titles": list(track.target_titles or []),
            "skills": list(track.key_skills or []),
            "skip": dict(track.skip_rules or {}),
            "notes": track.notes,
        },
    }
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
        for f, listing_id, collection_id, collection_name in rows:
            item = FindingOut.model_validate(f)
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
                findings=findings.get(r.id, []),
            )
        )
    return out


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


async def record_capture(db: AsyncSession, user_id: uuid.UUID, data: CaptureIn) -> bool:
    """Keep the extension's exact copy of a posting for the open run. Returns
    False (nothing stored) when no run is open or the link isn't a posting."""
    run_id = await active_run_id(db, user_id)
    key = url_key(data.url)
    if run_id is None or key is None or posting_problem(data.url):
        return False
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


async def brief(db: AsyncSession, user_id: uuid.UUID, run_id: str | None) -> dict:
    run = await _run_for_agent(db, user_id, run_id, start=True)
    c = run.criteria
    progress = await _progress(db, run)
    return {
        "run_id": str(run.id),
        "playbook": PLAYBOOK,
        "playbook_version": run.playbook_version,
        "source": c["source"],
        "start_urls": start_urls(c),
        "track": c["track"],
        "min_pay": c.get("min_pay"),
        "min_fit": c["min_fit"],
        "rubric": RUBRIC,
        "extra_instructions": c.get("extra_instructions"),
        "saving": _saving_note(c),
        "progress": progress,
        "next": (
            "Target reached: call finish_scout_run."
            if progress["done"]
            else "Open the start URL and send the first page of rows to check_jobs."
        ),
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


async def check_jobs(
    db: AsyncSession, user_id: uuid.UUID, run_id: str | None, rows: list[dict]
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    if len(rows) > MAX_ROWS_PER_CHECK:
        raise ValueError(f"Send at most {MAX_ROWS_PER_CHECK} rows per call (one page).")
    exclude = run.criteria["track"].get("skip", {}).get("exclude", [])
    keyed = []
    for row in rows:
        pair = (
            company_key(str(row.get("company", ""))),
            title_key(str(row.get("title", ""))),
        )
        uk = url_key(str(row.get("url") or ""))
        keyed.append((row, pair, uk))
    seen = await _seen_jobs(
        db,
        user_id,
        {p for _, p, _ in keyed if p[0] and p[1]},
        {u for _, _, u in keyed if u},
    )
    open_rows: list[int] = []
    skipped = {"in_tracker": 0, "seen_before": 0, "excluded": 0}
    for i, (row, pair, uk) in enumerate(keyed):
        why = seen.get(pair) or (seen.get(uk) if uk else None)
        if why:
            skipped[why] += 1
        elif _excluded(str(row.get("title", "")), exclude):
            skipped["excluded"] += 1
        else:
            open_rows.append(i)
    # So the page can say why a search came back short: "looked at 24, 9 seen
    # before, 4 skipped by title". Counts only, added up across pages; a row
    # Claude sends twice (the same page again) is counted once, by a short
    # fingerprint, never its text.
    stats = dict(run.stats or {})
    counted = set(stats.get("_rows", []))
    for i, (_row, pair, uk) in enumerate(keyed):
        mark = hashlib.sha1((uk or f"{pair[0]}|{pair[1]}").encode()).hexdigest()[:12]
        if mark in counted or not (uk or (pair[0] and pair[1])):
            continue
        counted.add(mark)
        stats["rows"] = stats.get("rows", 0) + 1
        why = seen.get(pair) or (seen.get(uk) if uk else None)
        if why:
            stats[why] = stats.get(why, 0) + 1
        elif i not in open_rows:
            stats["excluded"] = stats.get("excluded", 0) + 1
    stats["_rows"] = sorted(counted)[-2000:]
    run.stats = stats
    await db.flush()
    progress = await _progress(db, run)
    return {
        "open": open_rows,
        "skipped": skipped,
        "progress": progress,
        "next": (
            "Open each of these rows' postings in turn and report_job them."
            if open_rows
            else "None new on this page: go to the next page of results."
        ),
    }


def _pay_note(capture: ScoutCapture, min_pay: int | None) -> str | None:
    """The app's own pay check, on the pay the posting lists (never Claude's)."""
    top = capture.salary_max or capture.salary_min
    if not min_pay or not top:
        return None
    yearly = top * HOURS_PER_YEAR if capture.salary_period == "hourly" else top
    if yearly >= min_pay:
        return None
    return f"Pay listed up to ${yearly:,}, under your ${min_pay:,} minimum"


async def report_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    run_id: str | None,
    url: str,
    fit_score: int,
    why_fit: str,
    gaps: str,
) -> dict:
    run = await _run_for_agent(db, user_id, run_id)
    if not 0 <= int(fit_score) <= 10:
        raise ValueError("fit_score must be 0-10.")
    problem = posting_problem(url)
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
            track_id=run.track_id,
            folder_id=folder.id,
            capture=capture,
        )
    else:
        # A good fit: kept for the user to tick and save (the review step).
        finding.outcome = PICKED
        finding.app_note = None
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
