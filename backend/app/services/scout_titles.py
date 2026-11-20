"""The job titles an "Anything I'd be good at" search tries (spec 009).

Claude picks the titles from the user's resume each run; the app applies the
user's overrides (Always first, never a Never title), leaves out titles that
keep finding nothing, and remembers how each one did, so later runs keep the
titles that work and try new ones. Titles only, never job text.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scout import ScoutFinding, ScoutRun, ScoutTitle
from app.services import scout_instructions as instr
from app.services.scout_dedupe import title_key

MAX_TITLES = instr.LIMITS["titles"]  # searched in one run (the user can change it)
MAX_SENT = 20  # Claude may send this many to choose from
RESTING_RUNS = 3  # runs with no good fit before a title rests…
REST_DAYS = 14  # …for this long
BRIEF_TITLES = 30  # titles tried listed in the brief


def _now() -> datetime:
    return datetime.now(UTC)


def key(title: str) -> str:
    return title_key(title)[:200]


def _tidy(title) -> str:
    # As long as an override list allows, so any title can be pinned or blocked.
    return " ".join(str(title).split())[:80] if isinstance(title, str) else ""


def overrides(criteria: dict) -> dict[str, list[str]]:
    """The run's Always / Never / Avoid lists (snapshotted at Start)."""
    raw = (criteria or {}).get("overrides") or {}
    return {k: list(raw.get(k) or []) for k in ("always", "never", "avoid")}


def is_resting(row: ScoutTitle, now: datetime | None = None) -> bool:
    if row.runs < RESTING_RUNS or row.good_fits > 0 or row.last_tried_at is None:
        return False
    last = row.last_tried_at
    if last.tzinfo is None:  # SQLite hands back naive UTC
        last = last.replace(tzinfo=UTC)
    return last > (now or _now()) - timedelta(days=REST_DAYS)


async def _rows(db: AsyncSession, mission_id: uuid.UUID | None) -> list[ScoutTitle]:
    if mission_id is None:
        return []
    return list(
        await db.scalars(select(ScoutTitle).where(ScoutTitle.mission_id == mission_id))
    )


async def choose(
    db: AsyncSession, run: ScoutRun, titles: list
) -> tuple[list[str], list[dict]]:
    """The titles this run searches, and the ones left out with why. Always
    titles first, then Claude's in order; never a Never title, a resting one or
    the same title twice; at most ``MAX_TITLES``."""
    ov = overrides(run.criteria)
    never = {key(t) for t in ov["never"]}
    always_keys = {key(t) for t in ov["always"]}
    resting = {
        r.title_key
        for r in await _rows(db, run.mission_id)
        if r.title_key not in always_keys and is_resting(r)
    }
    kept: list[str] = []
    seen: set[str] = set()
    dropped: list[dict] = []
    for raw in ov["always"] + list(titles or [])[:MAX_SENT]:
        title = _tidy(raw)
        k = key(title)
        if not k or k in seen:  # blank, or the same title again: already decided
            continue
        seen.add(k)
        why = (
            "never_search"
            if k in never
            else "resting"
            if k in resting
            else "over_the_limit"
            if len(kept) >= instr.limit(run.criteria, "titles")
            else None
        )
        if why:
            dropped.append({"title": title, "why": why})
        else:
            kept.append(title)
    return kept, dropped


async def record_runs(db: AsyncSession, run: ScoutRun, titles: list[str]) -> None:
    """Each title searched counts one run (once per run, however often Claude
    sets them)."""
    if run.mission_id is None:
        return
    counted = set((run.criteria or {}).get("titles_counted") or [])
    rows = {r.title_key: r for r in await _rows(db, run.mission_id)}
    now = _now()
    # Titles set earlier in this run and now swapped out were never searched.
    for k in counted - {key(t) for t in titles}:
        if k in rows and rows[k].runs > 0:
            rows[k].runs -= 1
        counted.discard(k)
    for title in titles:
        k = key(title)
        if k in counted:
            continue
        counted.add(k)
        row = rows.get(k)
        if row is None:
            row = ScoutTitle(
                id=uuid.uuid4(),
                user_id=run.user_id,
                mission_id=run.mission_id,
                title=title[:200],
                title_key=k,
                runs=0,
                good_fits=0,
            )
            db.add(row)
            rows[k] = row
        row.runs += 1
        row.last_tried_at = now
    run.criteria = {**run.criteria, "titles_counted": sorted(counted)}


def best_title(job_title: str, titles: list[str]) -> str | None:
    """The searched title with the most words in common with the job's title
    (ties: the earlier one). None when no title shares a word with it: no
    title gets credit it may not have earned."""
    words = set(title_key(job_title).split())
    best, best_n = None, 0
    for t in titles:
        n = len(words & set(title_key(t).split()))
        if n > best_n:
            best, best_n = t, n
    return best


async def credit_fit(db: AsyncSession, run: ScoutRun, finding: ScoutFinding) -> None:
    """A good fit on a broad run: credit it to a searched title, once."""
    titles = list((run.criteria or {}).get("search_titles") or [])
    if finding.search_title or not titles:
        return
    title = best_title(finding.title, titles)
    if title is None:
        return
    finding.search_title = title[:200]
    if run.mission_id is None:
        return
    row = await db.scalar(
        select(ScoutTitle).where(
            ScoutTitle.mission_id == run.mission_id, ScoutTitle.title_key == key(title)
        )
    )
    if row is not None:
        row.good_fits += 1


def _out(row: ScoutTitle, always: set[str], never: set[str]) -> dict:
    return {
        "title": row.title,
        "runs": row.runs,
        "good_fits": row.good_fits,
        "last_tried_at": row.last_tried_at,
        "resting": row.title_key not in always and is_resting(row),
        "always": row.title_key in always,
        "never": row.title_key in never,
    }


async def tried(
    db: AsyncSession,
    mission_id: uuid.UUID | None,
    mission_overrides: dict | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Every title a broad search tried: most good fits first, then the most
    recently tried."""
    ov = overrides({"overrides": mission_overrides})
    always = {key(t) for t in ov["always"]}
    never = {key(t) for t in ov["never"]}
    rows = await _rows(db, mission_id)
    epoch = datetime(1970, 1, 1, tzinfo=UTC)

    def recent(r: ScoutTitle) -> datetime:
        last = r.last_tried_at or epoch
        return last if last.tzinfo else last.replace(tzinfo=UTC)

    rows.sort(key=lambda r: (-r.good_fits, -recent(r).timestamp()))
    out = [_out(r, always, never) for r in rows]
    return out[:limit] if limit else out


async def for_brief(db: AsyncSession, run: ScoutRun) -> list[dict]:
    """The titles tried, short, for Claude to keep what works and try new ones."""
    rows = await tried(
        db, run.mission_id, (run.criteria or {}).get("overrides"), BRIEF_TITLES
    )
    return [{k: r[k] for k in ("title", "runs", "good_fits", "resting")} for r in rows]
