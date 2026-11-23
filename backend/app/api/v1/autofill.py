"""Autofill bundle for Job Catcher (spec 015, contracts/autofill-bundle.md)."""

import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.taught_field import TaughtField
from app.models.user import User
from app.services import autofill_bundle as svc
from app.services import resume_history

router = APIRouter()


@router.get("/bundle")
async def get_bundle(
    background: BackgroundTasks,
    version: str | None = Query(None, max_length=64),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Everything autofill needs, or ``{"changed": false}`` when the version
    the extension holds is still current."""
    current = await svc.bundle_version(db, user.id, user.email or "")
    if version and version == current:
        return {"changed": False, "version": current}
    bundle = await svc.build_bundle(db, user.id, user.email or "")
    # Not read into work history yet: read it after responding; the next change
    # check picks it up (the version includes when it was read).
    resume_id = bundle.pop("resume_id", None)
    if bundle["history_pending"] and resume_id is not None:
        background.add_task(resume_history.read_in_background, resume_id)
    return bundle


# ---- Taught boxes (spec 017, contracts/taught-api.md) -------------------------
# A box the user pointed at in the side panel and taught ("Email", "First
# name", or typed text): remembered per site as a fingerprint, so the next
# fill finds it on its own — on every computer (it rides in the bundle).

PER_SITE = 50
PER_USER = 500
FINGERPRINT_BYTES = 4096


class TaughtIn(BaseModel):
    site: str = Field(min_length=1, max_length=255)
    fingerprint: dict
    profile_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{1,39}$")
    answer: str | None = Field(None, min_length=1, max_length=2000)

    @field_validator("fingerprint")
    @classmethod
    def _small_and_flat(cls, fp: dict) -> dict:
        if len(json.dumps(fp)) > FINGERPRINT_BYTES:
            raise ValueError("fingerprint too large")
        for k, v in fp.items():
            if not isinstance(k, str) or not (
                v is None or isinstance(v, str | int | float | bool)
            ):
                raise ValueError("fingerprint must be flat text, numbers or booleans")
        return fp

    @model_validator(mode="after")
    def _one_answer(self) -> "TaughtIn":
        if (self.profile_key is None) == (self.answer is None):
            raise ValueError("give exactly one of profile_key or answer")
        return self


def _same_box(a: dict, b: dict) -> bool:
    """The same box taught again. Its stable names (name / id / testid) decide
    when both sides have one — two boxes under one heading are NOT the same;
    without any, the same label in the same section at the same place."""
    if (a.get("kind") or "") != (b.get("kind") or ""):
        return False
    strong = [k for k in ("name", "id", "testid") if a.get(k) and b.get(k)]
    if strong:
        return all(a[k] == b[k] for k in strong)
    return (
        bool(a.get("label"))
        and a.get("label") == b.get("label")
        and a.get("section") == b.get("section")
        and a.get("index") == b.get("index")
    )


@router.post("/taught", status_code=201)
async def teach(
    body: TaughtIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remember a taught box (re-teaching the same box replaces it)."""
    rows = list(
        await db.scalars(
            select(TaughtField)
            .where(TaughtField.user_id == user.id, TaughtField.site == body.site)
            .order_by(TaughtField.updated_at, TaughtField.created_at)
        )
    )
    for row in rows:
        if _same_box(row.fingerprint or {}, body.fingerprint):
            await db.delete(row)
            rows.remove(row)
            break
    # Room for it: the oldest on this site go first, then the account's oldest.
    for row in rows[: max(0, len(rows) - PER_SITE + 1)]:
        await db.delete(row)
    total = await db.scalar(
        select(func.count())
        .select_from(TaughtField)
        .where(TaughtField.user_id == user.id)
    )
    if (total or 0) >= PER_USER:
        oldest = await db.scalar(
            select(TaughtField.id)
            .where(TaughtField.user_id == user.id)
            .order_by(TaughtField.updated_at)
            .limit(1)
        )
        await db.execute(delete(TaughtField).where(TaughtField.id == oldest))
    row = TaughtField(
        user_id=user.id,
        site=body.site,
        fingerprint=body.fingerprint,
        profile_key=body.profile_key,
        answer=body.answer,
    )
    db.add(row)
    await db.commit()
    return {"id": str(row.id)}


@router.get("/taught")
async def list_taught(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = await db.scalars(
        select(TaughtField)
        .where(TaughtField.user_id == user.id)
        .order_by(TaughtField.site, TaughtField.created_at)
    )
    return [
        {
            "id": str(r.id),
            "site": r.site,
            "label": str((r.fingerprint or {}).get("label") or "")[:120],
            "profile_key": r.profile_key,
            "answer_preview": (r.answer or "")[:40] if r.answer else None,
        }
        for r in rows
    ]


@router.delete("/taught/{taught_id}", status_code=204)
async def forget_taught(
    taught_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    gone = await db.execute(
        delete(TaughtField).where(
            TaughtField.id == taught_id, TaughtField.user_id == user.id
        )
    )
    if not gone.rowcount:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return Response(status_code=204)
