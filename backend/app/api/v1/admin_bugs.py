"""Bugs & ideas endpoints (spec 032): the owner's inbox. Every route needs
the owner (admin); anyone else gets 403 and sees nothing."""

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import AdminUser
from app.schemas.bug_reports import (
    BugBulk,
    BugCreate,
    BugLinkIn,
    BugMergeIn,
    BugNoteIn,
    BugPatch,
    Section,
    Severity,
)
from app.services import bug_reports as svc

router = APIRouter()

Source = Literal["owner", "owner_ai", "run", "caught"]


async def _detail(db: AsyncSession, report_id: uuid.UUID) -> dict[str, Any]:
    try:
        return await svc.detail(db, report_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("")
async def list_bugs(
    _user: AdminUser,
    type: Literal["bug", "idea"] = "bug",
    section: Section | None = None,
    severity: Severity | None = None,
    source: Source | None = None,
    status: str = Query("open", max_length=10),
    came_back: bool | None = None,
    needs_check: bool | None = None,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One tab (bugs or ideas), highest priority first, with its counts.
    ``status`` is one status, ``open`` (the default) or ``all``."""
    try:
        return await svc.list_reports(
            db,
            type=type,
            section=section,
            severity=severity,
            source=source,
            status=status,
            came_back=came_back,
            needs_check=needs_check,
            q=q,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("", status_code=201)
async def add_bug(
    data: BugCreate, _user: AdminUser, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """The owner's Add a bug or idea."""
    try:
        report = await svc.create(db, data.model_dump(), source="owner")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    return {"report": await svc.detail(db, report.id)}


@router.post("/bulk")
async def bulk_change(
    data: BugBulk, _user: AdminUser, db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Several at once: a status, a section, or both."""
    try:
        changed = await svc.bulk(db, data.ids, status=data.status, section=data.section)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    return {"changed": changed}


@router.get("/{report_id}")
async def get_bug(
    report_id: uuid.UUID, _user: AdminUser, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return await _detail(db, report_id)


@router.patch("/{report_id}")
async def change_bug(
    report_id: uuid.UUID,
    data: BugPatch,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        await svc.update_report(db, report_id, data.model_dump(exclude_unset=True))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    return await _detail(db, report_id)


@router.delete("/{report_id}", status_code=204)
async def delete_bug(
    report_id: uuid.UUID, _user: AdminUser, db: AsyncSession = Depends(get_db)
) -> Response:
    try:
        await svc.delete_report(db, report_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return Response(status_code=204)


@router.post("/{report_id}/notes", status_code=201)
async def add_note(
    report_id: uuid.UUID,
    data: BugNoteIn,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        ev = await svc.add_note(db, report_id, data.text)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    return svc.event_out(ev)


@router.post("/{report_id}/links", status_code=201)
async def add_link(
    report_id: uuid.UUID,
    data: BugLinkIn,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    try:
        added = await svc.link(db, report_id, data.other_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return {"linked": True, "already": not added}


@router.delete("/{report_id}/links/{other_id}", status_code=204)
async def remove_link(
    report_id: uuid.UUID,
    other_id: uuid.UUID,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await svc.unlink(db, report_id, other_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return Response(status_code=204)


@router.post("/{report_id}/merge")
async def merge_bug(
    report_id: uuid.UUID,
    data: BugMergeIn,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The same problem: this one goes into ``into_id`` (undo with split)."""
    try:
        into = await svc.merge(db, report_id, data.into_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return await _detail(db, into.id)


@router.post("/{report_id}/split/{event_id}")
async def split_bug(
    report_id: uuid.UUID,
    event_id: uuid.UUID,
    _user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Undo a merge; returns the report that's its own again."""
    try:
        back = await svc.split(db, report_id, event_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return await _detail(db, back.id)
