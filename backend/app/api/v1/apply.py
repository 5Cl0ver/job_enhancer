"""Apply with Claude routes (spec 022).

- The app: start a run on a saved job, watch it, answer Claude's questions,
  say keep going, decide at the review, stop. Owner only.
- Job Catcher (its pass allowed): what's open and what to do, claim a request,
  send photos and results, and report a Submit press.
- Things told to Claude: list, edit, delete (Settings › Résumés).

Photos are only ever served to their owner, by id, with no caching.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.apply import ProfileFact
from app.models.user import User
from app.schemas.apply import (
    AnswersIn,
    ApplyStart,
    DecisionIn,
    ExtensionEvent,
    FactIn,
    FactOut,
    RequestResult,
)
from app.services import apply_runs as svc
from app.services import master_profile

router = APIRouter()
facts_router = APIRouter()


async def _run(db: AsyncSession, user: User, run_id: uuid.UUID, *, lock: bool = False):
    try:
        return await svc.get_run(db, user.id, run_id, lock=lock)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Application not found") from exc


def _bad(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# The app
# --------------------------------------------------------------------------- #


@router.post("/runs", status_code=201)
async def start_run(
    data: ApplyStart,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        run = await svc.create_run(db, user, data.saved_job_id)
    except svc.RunBusy as busy:
        await db.commit()  # keep any runs just expired
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Another application is already going.",
                "open_run_id": str(busy.run_id),
            },
        )
    await db.commit()
    return await svc.view(db, run)


@router.get("/runs/open")
async def open_run(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await svc.open_run(db, user.id)
    await db.commit()
    return await svc.view(db, run, full=False) if run else None


@router.get("/runs")
async def runs_for_job(
    saved_job_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    runs = await svc.runs_for_job(db, user.id, saved_job_id)
    await db.commit()
    return [await svc.view(db, r, full=False) for r in runs]


@router.get("/runs/{run_id}")
async def get_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await _run(db, user, run_id)
    return await svc.view(db, run)


@router.post("/runs/{run_id}/answers")
async def answer(
    run_id: uuid.UUID,
    data: AnswersIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await _run(db, user, run_id, lock=True)
    if run.status != svc.APPLY_QUESTIONS:
        raise HTTPException(
            status_code=400, detail="Claude isn't asking questions now."
        )
    await svc.record_answers(
        db, run, [a.model_dump() for a in data.answers], done=data.done, source="app"
    )
    await db.commit()
    return await svc.view(db, run)


@router.post("/runs/{run_id}/help-done")
async def help_done(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _run(db, user, run_id)
    try:
        run = await svc.help_done(db, user.id, run_id)
    except ValueError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.view(db, run)


@router.post("/runs/{run_id}/decision")
async def decision(
    run_id: uuid.UUID,
    data: DecisionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = await _run(db, user, run_id, lock=True)
    try:
        await svc.decide(db, run, data.decision, data.note, by="app")
    except ValueError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.view(db, run)


@router.post("/runs/{run_id}/sent")
async def sent(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _run(db, user, run_id)
    try:
        run = await svc.mark_sent(
            db, user.id, run_id, "You said you sent it. It's in Applied."
        )
    except ValueError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return await svc.view(db, run)


@router.post("/runs/{run_id}/stop")
async def stop(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _run(db, user, run_id)
    run = await svc.stop_run(db, user.id, run_id)
    await db.commit()
    return await svc.view(db, run)


@router.get("/photos/{photo_id}")
async def photo(
    photo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        data = await svc.photo_bytes(db, user.id, photo_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Photo not found") from exc
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# --------------------------------------------------------------------------- #
# Job Catcher
# --------------------------------------------------------------------------- #


@router.get("/active")
async def active(
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
):
    out = await svc.extension_state(db, user.id)
    await db.commit()
    return out


@router.post("/requests/{request_id}/claim")
async def claim(
    request_id: uuid.UUID,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await svc.claim(db, user.id, request_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Request not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    return {"id": str(req.id), "kind": req.kind, "url": req.url, "page_n": req.page_n}


@router.post("/requests/{request_id}/photo", status_code=201)
async def add_photo(
    request_id: uuid.UUID,
    request: Request,
    part: int = Query(..., ge=0, lt=svc.MAX_PARTS),
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
):
    if request.headers.get("content-type", "").split(";")[0].strip() != "image/jpeg":
        raise HTTPException(status_code=415, detail="Send the photo as image/jpeg.")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > svc.MAX_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail="A photo must be under 400 KB.")
    try:
        photo = await svc.add_photo(db, user.id, request_id, part, body)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Request not found") from exc
    except ValueError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return {"id": str(photo.id), "part": photo.part}


@router.post("/requests/{request_id}/result")
async def request_result(
    request_id: uuid.UUID,
    data: RequestResult,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await svc.finish_request(db, user.id, request_id, data.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Request not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    return {"id": str(req.id), "status": req.status}


@router.post("/runs/{run_id}/event")
async def extension_event(
    run_id: uuid.UUID,
    data: ExtensionEvent,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
):
    await _run(db, user, run_id)
    try:
        run = await svc.extension_event(db, user.id, run_id, data.kind, data.url)
    except ValueError as exc:
        raise _bad(exc) from exc
    await db.commit()
    return {"status": run.status}


# --------------------------------------------------------------------------- #
# Things told to Claude
# --------------------------------------------------------------------------- #


async def _fact(db: AsyncSession, user: User, fact_id: uuid.UUID) -> ProfileFact:
    fact = await db.scalar(
        select(ProfileFact).where(
            ProfileFact.id == fact_id, ProfileFact.user_id == user.id
        )
    )
    if fact is None:
        raise HTTPException(status_code=404, detail="Not found")
    return fact


@facts_router.get("", response_model=list[FactOut])
async def list_facts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FactOut]:
    return [
        FactOut.model_validate(f)
        for f in await master_profile.facts(db, user.id, limit=None)
    ]


@facts_router.patch("/{fact_id}", response_model=FactOut)
async def edit_fact(
    fact_id: uuid.UUID,
    data: FactIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FactOut:
    fact = await _fact(db, user, fact_id)
    fact.answer = data.answer.strip()
    fact.updated_at = svc._now()
    await db.commit()
    return FactOut.model_validate(fact)


@facts_router.delete("/{fact_id}", status_code=204)
async def delete_fact(
    fact_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await db.delete(await _fact(db, user, fact_id))
    await db.commit()
