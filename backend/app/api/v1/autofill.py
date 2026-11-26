"""Autofill bundle for Job Catcher (spec 015, contracts/autofill-bundle.md)."""

import io
import json
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import get_db
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.resume import Resume
from app.models.taught_field import TaughtField
from app.models.user import User
from app.services import apply_resume, resume_history
from app.services import autofill_bundle as svc
from app.services.extension_connect import TOKEN_PREFIX
from app.utils.content_disposition import file_headers

router = APIRouter()


@router.get("/bundle")
async def get_bundle(
    background: BackgroundTasks,
    version: str | None = Query(None, max_length=64),
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Everything autofill needs, or ``{"changed": false}`` when the version
    the extension holds is still current."""
    # The usual résumé read before 029 and never edited is read again once
    # (it changes the version, so Job Catcher picks it up).
    await resume_history.upgrade_active(db, user.id)
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
    user: User = Depends(get_user_or_pass),
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
    user: User = Depends(get_user_or_pass),
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
            # The whole answer, for editing it in the app's Autofill memory.
            "answer": r.answer,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


class TaughtEdit(BaseModel):
    profile_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{1,39}$")
    answer: str | None = Field(None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _one_answer(self) -> "TaughtEdit":
        if (self.profile_key is None) == (self.answer is None):
            raise ValueError("give exactly one of profile_key or answer")
        return self


@router.patch("/taught/{taught_id}")
async def edit_taught(
    taught_id: uuid.UUID,
    body: TaughtEdit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Change what a taught box gets (the app's Autofill memory)."""
    row = await db.scalar(
        select(TaughtField).where(
            TaughtField.id == taught_id, TaughtField.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    row.profile_key = body.profile_key
    row.answer = body.answer
    await db.commit()
    return {"id": str(row.id)}


@router.delete("/taught/{taught_id}", status_code=204)
async def forget_taught(
    taught_id: uuid.UUID,
    user: User = Depends(get_user_or_pass),
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


# ---- Résumé details (spec 020, R7) ---------------------------------------------
# Each résumé's own jobs, schools, skills, certifications and websites — read
# from the file (services/resume_history.py), editable in the app, and used by
# Job Catcher to fill "enter your résumé again" pages from the résumé the user
# picked for that application.


class WorkEntry(BaseModel):
    title: str = Field("", max_length=200)
    company: str = Field("", max_length=200)
    location: str = Field("", max_length=200)
    start_month: int | None = Field(None, ge=1, le=12)
    start_year: int | None = Field(None, ge=1900, le=2100)
    end_month: int | None = Field(None, ge=1, le=12)
    end_year: int | None = Field(None, ge=1900, le=2100)
    current: bool = False
    description: str = Field("", max_length=2000)


class SchoolEntry(BaseModel):
    school: str = Field("", max_length=200)
    degree: str = Field("", max_length=200)
    field_of_study: str = Field("", max_length=200)
    start_year: int | None = Field(None, ge=1900, le=2100)
    end_year: int | None = Field(None, ge=1900, le=2100)


class ResumeDetails(BaseModel):
    work: list[WorkEntry] = Field(default_factory=list, max_length=15)
    education: list[SchoolEntry] = Field(default_factory=list, max_length=8)
    skills: list[str] = Field(default_factory=list, max_length=80)
    certifications: list[str] = Field(default_factory=list, max_length=30)
    websites: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("skills", "certifications")
    @classmethod
    def _short_items(cls, items: list[str]) -> list[str]:
        out = [i.strip() for i in items if i and i.strip()]
        if any(len(i) > 160 for i in out):
            raise ValueError("Each item must be 160 characters or fewer")
        return out

    @field_validator("websites")
    @classmethod
    def _web_addresses(cls, items: list[str]) -> list[str]:
        out = []
        for raw in items:
            url = (raw or "").strip()
            if not url:
                continue
            if not url.lower().startswith(("http://", "https://")):
                url = "https://" + url
            if len(url) > 300 or " " in url:
                raise ValueError("Websites must be web addresses")
            out.append(url)
        return out


class ResumeDetailsOut(ResumeDetails):
    resume_id: uuid.UUID
    filename: str
    read: bool


def _valid(model: type[BaseModel], items: object, limit: int) -> list:
    """The entries that pass the model; anything else is left out (never a
    500 for one bad entry)."""
    out = []
    for item in items if isinstance(items, list) else []:
        try:
            out.append(model.model_validate(item))
        except ValidationError:
            continue
    return out[:limit]


def _texts(items: object, longest: int, limit: int) -> list[str]:
    return [
        i.strip()
        for i in (items if isinstance(items, list) else [])
        if isinstance(i, str) and i.strip() and len(i.strip()) <= longest
    ][:limit]


def _details(resume: Resume) -> ResumeDetailsOut:
    stored = resume.parsed_history if isinstance(resume.parsed_history, dict) else {}
    websites = [
        w
        for w in _texts(stored.get("websites"), 300, 50)
        if w.lower().startswith(("http://", "https://")) and " " not in w
    ][:10]
    return ResumeDetailsOut(
        resume_id=resume.id,
        filename=resume.filename,
        read=resume.parsed_history_at is not None,
        work=_valid(WorkEntry, stored.get("work"), 15),
        education=_valid(SchoolEntry, stored.get("education"), 8),
        skills=_texts(stored.get("skills"), 160, 80),
        certifications=_texts(stored.get("certifications"), 160, 30),
        websites=websites,
    )


async def _own_resume(db: AsyncSession, user: User, resume_id: uuid.UUID) -> Resume:
    resume = await db.scalar(
        select(Resume)
        .options(defer(Resume.file_data))
        .where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    if resume is None:
        raise HTTPException(status_code=404, detail="Not found")
    return resume


@router.get("/resumes/{resume_id}/details", response_model=ResumeDetailsOut)
async def get_resume_details(
    resume_id: uuid.UUID,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> ResumeDetailsOut:
    """One of the user's résumés, read into details (Job Catcher fills from it)."""
    resume = await _own_resume(db, user, resume_id)
    # A job's résumé that still carries the master's details reads its own
    # (spec 029): Workday's sections fill from THIS résumé.
    # Read before 029 and never edited: read again, once (spec 029).
    if await apply_resume.refresh_borrowed(db, resume) or resume_history.upgrade(
        resume
    ):
        await db.commit()
        await db.refresh(resume)
    return _details(resume)


@router.put("/resumes/{resume_id}/details", response_model=ResumeDetailsOut)
async def edit_resume_details(
    resume_id: uuid.UUID,
    data: ResumeDetails,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResumeDetailsOut:
    """The user's corrections, from the app. Replaces the stored details."""
    from datetime import UTC, datetime

    resume = await _own_resume(db, user, resume_id)
    # Marked as the user's own: no reading ever replaces it (spec 029).
    resume.parsed_history = {
        **data.model_dump(),
        "reader": resume_history.READER_VERSION,
        "edited": True,
    }
    resume.parsed_history_at = datetime.now(tz=UTC)
    await db.commit()
    await db.refresh(resume)
    return _details(resume)


@router.post("/promoted", status_code=204)
async def mark_promoted(
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Job Catcher turned this account's one-site answers into answers for every
    site (spec 020). Recorded once per account, so it never runs again — not on
    another computer, and an answer deleted in the app stays deleted."""
    from datetime import UTC, datetime

    if user.learn_promoted_at is None:
        user.learn_promoted_at = datetime.now(tz=UTC)
        await db.commit()
    return Response(status_code=204)


@router.post("/resumes/{resume_id}/read", response_model=ResumeDetailsOut)
async def reread_resume(
    resume_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> ResumeDetailsOut:
    """Read my résumé: read the file again (built-in reader, no AI), replacing
    the stored details. Job Catcher also calls it for a chosen résumé that was
    never read (spec 020), so its sections never come from another résumé."""
    resume = await _own_resume(db, user, resume_id)
    # Job Catcher's pass may only read a résumé that was never read: it can
    # never overwrite details the user edited in the app (spec 020 review).
    via_pass = request.headers.get("authorization", "").startswith(
        f"Bearer {TOKEN_PREFIX}"
    )
    if via_pass and resume.parsed_history_at is not None:
        return _details(resume)
    if not (resume.extracted_text or "").strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "This résumé has no readable text. "
                "Upload it again as a PDF or Word file."
            ),
        )
    await resume_history.read_resume(resume)
    await db.commit()
    await db.refresh(resume)
    return _details(resume)


@router.get("/resumes/{resume_id}/file")
async def resume_file(
    resume_id: uuid.UUID,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """A chosen résumé's original file, for Job Catcher to upload to the job it
    was picked for (the active one keeps its own route)."""
    resume = await db.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    if resume is None or not resume.file_data:
        raise HTTPException(status_code=404, detail="Not found")
    return StreamingResponse(
        io.BytesIO(resume.file_data),
        media_type=resume.mime_type,
        headers=file_headers(resume.filename),
    )
