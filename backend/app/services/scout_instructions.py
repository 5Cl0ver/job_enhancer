"""Everything Claude Scout tells Claude, and the user's own edits (spec 010).

The originals are the texts in ``app/scout/*.md`` and the defaults below. A
user can edit the main steps, the extra steps per kind of search, the scoring
weights and three limits; each save is a version (history, reset, restore).
The rules in ``rules.md`` are locked: the app adds them after the user's main
steps on every run, so no edit can remove them.

A run snapshots its instructions when it's queued (``snapshot``) and its brief
reads from that, so editing mid-run never changes a run already going.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scout import ScoutInstructionVersion

_DIR = Path(__file__).parent.parent / "scout"


def _read(name: str) -> str:
    return (_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


TEXT_KEYS = ("playbook", "google_jobs", "local_companies", "broad")
KEYS = TEXT_KEYS + ("rubric", "limits")
TITLES = {
    "playbook": "Main steps",
    "google_jobs": "Extra steps: Google Jobs",
    "local_companies": "Extra steps: Local companies",
    "broad": "Extra steps: Anything I'd be good at",
    "rubric": "Scoring",
    "limits": "Limits",
}
RULES = _read("rules")
RUBRIC = {
    "skills": 4,
    "experience": 2,
    "title_level": 2,
    "recency": 1,
    "pay_location": 1,
}
RUBRIC_LABELS = {
    "skills": "skills match",
    "experience": "experience met",
    "title_level": "title and level",
    "recency": "posted recently",
    "pay_location": "pay and location",
}
LIMITS = {"links": 6, "search_pages": 2, "titles": 8, "companies": 15}
LIMIT_RANGES = {
    "links": (1, 10),
    "search_pages": (1, 8),
    "titles": (2, 8),
    "companies": (5, 25),
}
LIMIT_LABELS = {
    "links": "Searches a run makes (one per title)",
    "search_pages": "Results pages read per search",
    "titles": "Titles an Anything I'd be good at run searches",
    "companies": "Companies a Local companies run checks",
}
# Shown on the page, not editable.
FIXED_LIMITS = (
    ("Titles that didn't fit are skipped for", "30 days"),
    ("A broad search's title rests after", "3 runs with no good fit, for 14 days"),
    ("A local company is checked again after", "7 days (at most 3 a run)"),
    ("Rows sent in one check", "30"),
)
MAX_TEXT = 8000
HISTORY = 20

ORIGINALS: dict[str, object] = {
    **{k: _read(k) for k in TEXT_KEYS},
    "rubric": RUBRIC,
    "limits": LIMITS,
}


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(value: object) -> str:
    raw = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _decode(key: str, body: str | None) -> object:
    if body is None:
        return ORIGINALS[key]
    if key in TEXT_KEYS:
        return body
    # Only the parts there are now: a limit saved under an old name is dropped.
    saved = {k: v for k, v in json.loads(body).items() if k in ORIGINALS[key]}
    return {**ORIGINALS[key], **saved}


def rubric_text(weights: dict) -> str:
    parts = ", ".join(f"{RUBRIC_LABELS[k]} {weights[k]}" for k in RUBRIC)
    return (
        f"Rubric (out of 10, judged against the resume): {parts}. Count the "
        "user's experience as equal to a degree unless the posting strictly "
        "requires one and the resume type's skip rules say degree_only. Pay "
        "that isn't listed counts as met, and on-site, hybrid and remote are "
        "all fine. Judge the level by the brief's level_rule: a role above the "
        "user's levels is a stretch however well the skills match. Be honest: a "
        "9 or 10 means the user meets nearly everything listed."
    )


def assemble_playbook(main_steps: str, weights: dict) -> str:
    """What Claude gets as the playbook: the user's main steps, then the
    scoring line, then the locked rules, always last."""
    return f"{main_steps.strip()}\n\n{rubric_text(weights)}\n\n{RULES}"


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def _check(key: str, text: str | None, values: dict | None) -> str:
    """The body to store for a save, or 422 with what's wrong."""
    if key in TEXT_KEYS:
        text = (text or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="Write something, or Reset.")
        if len(text) > MAX_TEXT:
            raise HTTPException(
                status_code=422,
                detail=f"Keep it under {MAX_TEXT:,} characters (now {len(text):,}).",
            )
        return text
    values = values or {}
    if key == "rubric":
        if set(values) != set(RUBRIC):
            raise HTTPException(status_code=422, detail="Give a weight for each part.")
        if not all(isinstance(v, int) and 0 <= v <= 10 for v in values.values()):
            raise HTTPException(
                status_code=422, detail="Each weight is a whole number from 0 to 10."
            )
        total = sum(values.values())
        if total != 10:
            raise HTTPException(
                status_code=422,
                detail=f"The parts must add up to 10 (now {total}).",
            )
        return json.dumps({k: values[k] for k in RUBRIC})
    if set(values) - set(LIMITS):
        raise HTTPException(status_code=422, detail="Unknown limit.")
    merged = {**LIMITS, **values}
    for name, (lo, hi) in LIMIT_RANGES.items():
        v = merged[name]
        if not isinstance(v, int) or not lo <= v <= hi:
            raise HTTPException(
                status_code=422,
                detail=f"{LIMIT_LABELS[name]}: choose {lo} to {hi}.",
            )
    return json.dumps({k: merged[k] for k in LIMITS})


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #
def _key(key: str) -> str:
    if key not in KEYS:
        raise HTTPException(status_code=404, detail="No such instruction.")
    return key


async def _latest(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, ScoutInstructionVersion]:
    rows = await db.scalars(
        select(ScoutInstructionVersion)
        .where(ScoutInstructionVersion.user_id == user_id)
        .order_by(ScoutInstructionVersion.created_at.desc())
    )
    out: dict[str, ScoutInstructionVersion] = {}
    for row in rows:
        out.setdefault(row.key, row)
    return out


async def _add(
    db: AsyncSession, user_id: uuid.UUID, key: str, body: str | None
) -> None:
    db.add(
        ScoutInstructionVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            key=key,
            body=body,
            base_hash=_hash(ORIGINALS[key]),
            created_at=_now(),
        )
    )
    await db.flush()
    keep = (
        await db.scalars(
            select(ScoutInstructionVersion.id)
            .where(
                ScoutInstructionVersion.user_id == user_id,
                ScoutInstructionVersion.key == key,
            )
            .order_by(ScoutInstructionVersion.created_at.desc())
            .limit(HISTORY)
        )
    ).all()
    await db.execute(
        delete(ScoutInstructionVersion).where(
            ScoutInstructionVersion.user_id == user_id,
            ScoutInstructionVersion.key == key,
            ScoutInstructionVersion.id.not_in(keep),
        )
    )


def _section(key: str, row: ScoutInstructionVersion | None) -> dict:
    edited = row is not None and row.body is not None
    out = {
        "key": key,
        "title": TITLES[key],
        "kind": "text" if key in TEXT_KEYS else key,
        "original": ORIGINALS[key],
        "current": _decode(key, row.body if row else None),
        "edited": edited,
        "edited_at": row.created_at if edited else None,
        "original_changed": edited and row.base_hash != _hash(ORIGINALS[key]),
    }
    if key == "limits":
        out["ranges"] = {k: list(v) for k, v in LIMIT_RANGES.items()}
        out["labels"] = LIMIT_LABELS
    if key == "rubric":
        out["labels"] = RUBRIC_LABELS
    return out


async def sections(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    latest = await _latest(db, user_id)
    return [_section(k, latest.get(k)) for k in KEYS]


async def section(db: AsyncSession, user_id: uuid.UUID, key: str) -> dict:
    return _section(key, (await _latest(db, user_id)).get(key))


async def save(
    db: AsyncSession,
    user_id: uuid.UUID,
    key: str,
    text: str | None = None,
    values: dict | None = None,
) -> dict:
    key = _key(key)
    if key == "limits":  # the ones not sent keep the user's own values
        values = {**(await section(db, user_id, key))["current"], **(values or {})}
    await _add(db, user_id, key, _check(key, text, values))
    return await section(db, user_id, key)


async def reset(db: AsyncSession, user_id: uuid.UUID, key: str) -> dict:
    key = _key(key)
    await _add(db, user_id, key, None)
    return await section(db, user_id, key)


async def history(db: AsyncSession, user_id: uuid.UUID, key: str) -> list[dict]:
    key = _key(key)
    rows = await db.scalars(
        select(ScoutInstructionVersion)
        .where(
            ScoutInstructionVersion.user_id == user_id,
            ScoutInstructionVersion.key == key,
        )
        .order_by(ScoutInstructionVersion.created_at.desc())
        .limit(HISTORY)
    )
    return [
        {
            "id": r.id,
            "created_at": r.created_at,
            "reset": r.body is None,
            "body": _decode(key, r.body),
        }
        for r in rows
    ]


async def restore(
    db: AsyncSession, user_id: uuid.UUID, key: str, version_id: uuid.UUID
) -> dict:
    key = _key(key)
    row = await db.scalar(
        select(ScoutInstructionVersion).where(
            ScoutInstructionVersion.id == version_id,
            ScoutInstructionVersion.user_id == user_id,
            ScoutInstructionVersion.key == key,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No such version.")
    body = row.body
    if body is not None:  # still within today's limits and lengths
        try:
            body = (
                _check(key, body, None)
                if key in TEXT_KEYS
                else _check(key, None, json.loads(body))
            )
        except HTTPException as e:
            raise HTTPException(
                status_code=422, detail=f"That version can't be used now: {e.detail}"
            ) from None
    await _add(db, user_id, key, body)
    return await section(db, user_id, key)


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #
async def snapshot(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """The instructions a run uses, as of now: which sections are edited (and
    when), the edited texts, the weights and the limits."""
    latest = await _latest(db, user_id)
    edited = {k: row for k, row in latest.items() if row.body is not None and k in KEYS}
    return {
        "instructions": {
            k: (edited[k].created_at.isoformat() if k in edited else None) for k in KEYS
        },
        "texts": {k: edited[k].body for k in TEXT_KEYS if k in edited},
        "rubric": _decode(
            "rubric", edited["rubric"].body if "rubric" in edited else None
        ),
        "limits": _decode(
            "limits", edited["limits"].body if "limits" in edited else None
        ),
    }


def text_for(criteria: dict, key: str) -> str:
    """A run's text for one section: its snapshot's edit, or the original."""
    return ((criteria or {}).get("texts") or {}).get(key) or ORIGINALS[key]


def rubric_for(criteria: dict) -> dict:
    return dict((criteria or {}).get("rubric") or RUBRIC)


def limit(criteria: dict, name: str) -> int:
    return int(((criteria or {}).get("limits") or {}).get(name) or LIMITS[name])
