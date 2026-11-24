"""Résumé details and the résumé chosen per job (spec 020, R7). Invented data."""

import hashlib
import secrets
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import ExtensionToken
from app.models.resume import Resume
from app.models.user import User
from app.services.users import create_user

pytestmark = pytest.mark.asyncio

TEXT = (
    "EXPERIENCE\n"
    "Data Analyst | Tidewell Labs | Mar 2023 - Present\n"
    "- Built dashboards\n"
    "Support Analyst | Quillstone | Jan 2020 - Feb 2023\n"
    "SKILLS\nSQL, Python, Tableau\n"
)


async def _resume(
    db: AsyncSession, user: User, name: str = "wren.pdf", text: str = TEXT
) -> Resume:
    r = Resume(
        id=uuid.uuid4(),
        user_id=user.id,
        filename=name,
        mime_type="application/pdf",
        file_size_bytes=4,
        file_data=b"%PDF",
        extracted_text=text,
        is_active=False,
    )
    db.add(r)
    await db.commit()
    return r


def _no_ai():
    return (
        patch(
            "app.services.ai_service.parse_work_history", new=AsyncMock(return_value=[])
        ),
        patch(
            "app.services.ai_service.parse_education", new=AsyncMock(return_value=[])
        ),
    )


async def test_read_my_resume_then_edit_the_details(
    client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user)
    first = (await client.get(f"/v1/autofill/resumes/{r.id}/details")).json()
    assert first["read"] is False and first["work"] == []

    a, b = _no_ai()
    with a, b:
        read = (await client.post(f"/v1/autofill/resumes/{r.id}/read")).json()
    assert read["read"] is True
    assert [j["company"] for j in read["work"]] == ["Tidewell Labs", "Quillstone"]
    assert read["skills"] == ["SQL", "Python", "Tableau"]

    read["work"][0]["title"] = "Senior Data Analyst"
    read["skills"].append("Looker")
    read["websites"] = ["github.com/wren"]
    saved = (await client.put(f"/v1/autofill/resumes/{r.id}/details", json=read)).json()
    assert saved["work"][0]["title"] == "Senior Data Analyst"
    assert "Looker" in saved["skills"]
    assert saved["websites"] == ["https://github.com/wren"]


async def test_details_are_validated(client: AsyncClient, db_session, test_user):
    r = await _resume(db_session, test_user)
    bad = {"work": [{"title": "x", "start_month": 13}]}
    assert (
        await client.put(f"/v1/autofill/resumes/{r.id}/details", json=bad)
    ).status_code == 422
    bad = {"websites": ["not a link"]}
    assert (
        await client.put(f"/v1/autofill/resumes/{r.id}/details", json=bad)
    ).status_code == 422
    bad = {"skills": ["s"] * 81}
    assert (
        await client.put(f"/v1/autofill/resumes/{r.id}/details", json=bad)
    ).status_code == 422


async def test_someone_elses_resume_is_not_found(client: AsyncClient, db_session):
    other = await create_user(db_session, email="other@test.dev", name="Other")
    r = await _resume(db_session, other)
    for method, path in [
        ("GET", f"/v1/autofill/resumes/{r.id}/details"),
        ("PUT", f"/v1/autofill/resumes/{r.id}/details"),
        ("POST", f"/v1/autofill/resumes/{r.id}/read"),
        ("GET", f"/v1/autofill/resumes/{r.id}/file"),
    ]:
        kwargs = {"json": {}} if method == "PUT" else {}
        assert (await client.request(method, path, **kwargs)).status_code == 404, path


async def test_the_chosen_resume_file(client: AsyncClient, db_session, test_user):
    r = await _resume(db_session, test_user, name="wren-data.pdf")
    got = await client.get(f"/v1/autofill/resumes/{r.id}/file")
    assert got.status_code == 200
    assert got.content == b"%PDF"
    assert got.headers["x-resume-filename"] == "wren-data.pdf"


async def test_choose_a_resume_for_a_job_and_it_shows_in_the_summary(
    client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user, name="wren-data.pdf")
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://careers.example/jobs/1",
                "title": "Data Analyst",
                "company": "Kelso Labs",
            },
        )
    ).json()
    before = (await client.get("/v1/saved-jobs/summary")).json()
    assert before["jobs"][0]["resume_id"] is None

    got = await client.put(
        f"/v1/saved-jobs/{saved['id']}/resume", json={"resume_id": str(r.id)}
    )
    assert got.status_code == 204
    after = (
        await client.get(f"/v1/saved-jobs/summary?version={before['version']}")
    ).json()
    assert after["changed"] is True
    assert after["jobs"][0]["resume_id"] == str(r.id)

    # Back to the usual one.
    await client.put(f"/v1/saved-jobs/{saved['id']}/resume", json={"resume_id": None})
    assert (await client.get("/v1/saved-jobs/summary")).json()["jobs"][0][
        "resume_id"
    ] is None


async def test_a_job_cannot_point_at_someone_elses_resume(
    client: AsyncClient, db_session
):
    other = await create_user(db_session, email="other2@test.dev", name="Other")
    theirs = await _resume(db_session, other)
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://careers.example/jobs/2",
                "title": "Analyst",
                "company": "Kelso Labs",
            },
        )
    ).json()
    got = await client.put(
        f"/v1/saved-jobs/{saved['id']}/resume", json={"resume_id": str(theirs.id)}
    )
    assert got.status_code == 404


async def _a_pass(db: AsyncSession, user: User) -> str:
    token = "jcx_" + secrets.token_urlsafe(32)
    db.add(
        ExtensionToken(
            user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest()
        )
    )
    await db.commit()
    return token


async def test_job_catcher_can_read_but_not_edit_or_reread(
    anon_client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user)
    auth = {"Authorization": f"Bearer {await _a_pass(db_session, test_user)}"}
    assert (
        await anon_client.get(f"/v1/autofill/resumes/{r.id}/details", headers=auth)
    ).status_code == 200
    assert (
        await anon_client.get(f"/v1/autofill/resumes/{r.id}/file", headers=auth)
    ).status_code == 200
    assert (
        await anon_client.put(
            f"/v1/autofill/resumes/{r.id}/details", headers=auth, json={}
        )
    ).status_code == 401
    assert (
        await anon_client.post(f"/v1/autofill/resumes/{r.id}/read", headers=auth)
    ).status_code == 401


async def test_the_backfill_reads_unread_resumes(db_session, test_user):
    """Résumés left unread while the AI was down get read by the hourly job."""
    from contextlib import asynccontextmanager

    from app.services import resume_history

    r = await _resume(db_session, test_user)

    @asynccontextmanager
    async def same_session():
        yield db_session

    a, b = _no_ai()
    with a, b, patch.object(resume_history, "session_factory", same_session):
        n = await resume_history.read_unread_resumes(same_session)
    assert n == 1
    await db_session.refresh(r)
    assert r.parsed_history_at is not None
    assert r.parsed_history["work"][0]["company"] == "Tidewell Labs"


async def test_the_backfill_gives_up_on_a_resume_that_keeps_failing(
    db_session, test_user
):
    """A reading that crashes is counted first, so after 3 tries the hourly job
    stops picking that résumé; blank résumés are never picked."""
    from contextlib import asynccontextmanager

    from app.services import resume_history

    bad = await _resume(db_session, test_user, name="bad.pdf")
    blank = await _resume(db_session, test_user, name="blank.pdf", text="   ")

    @asynccontextmanager
    async def same_session():
        yield db_session

    def crash(_text):
        raise RuntimeError("reader blew up")

    with (
        patch.object(resume_history, "session_factory", same_session),
        patch("app.services.resume_reader.read", side_effect=crash),
    ):
        for _ in range(5):
            await resume_history.read_unread_resumes(same_session)
    await db_session.refresh(bad)
    await db_session.refresh(blank)
    assert bad.read_attempts == resume_history.MAX_ATTEMPTS
    assert bad.parsed_history_at is None
    assert blank.read_attempts == 0  # never picked: nothing to read


async def test_any_file_name_downloads(client: AsyncClient, db_session, test_user):
    """A name that isn't plain ASCII used to be a 500 (headers are latin-1)."""
    from urllib.parse import unquote

    r = await _resume(db_session, test_user, name="Résumé – Wren.pdf")
    r.is_active = True
    await db_session.commit()
    for path in (f"/v1/autofill/resumes/{r.id}/file", "/v1/ai/resumes/active/file"):
        got = await client.get(path)
        assert got.status_code == 200, path
        assert unquote(got.headers["x-resume-filename"]) == "Résumé – Wren.pdf"
        assert "filename*=UTF-8''R%C3%A9sum%C3%A9" in got.headers["content-disposition"]
        assert got.headers["x-content-type-options"] == "nosniff"


async def test_bad_stored_entries_are_left_out_not_a_500(
    client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user)
    r.parsed_history = {
        "work": [
            {"title": "Analyst", "company": "Kelso Labs", "start_year": 1066},
            {"title": "Engineer", "company": "Quillstone", "start_year": 2020},
            "not a job",
        ],
        "education": [{"school": "x" * 500}],
        "skills": ["SQL", 42, "y" * 999],
        "certifications": None,
        "websites": [
            "https://github.com/wren",
            "javascript:alert(1)",
            "https://" + "a" * 400,
        ],
    }
    from datetime import UTC, datetime

    r.parsed_history_at = datetime.now(tz=UTC)
    await db_session.commit()
    got = await client.get(f"/v1/autofill/resumes/{r.id}/details")
    assert got.status_code == 200
    d = got.json()
    assert [j["company"] for j in d["work"]] == ["Quillstone"]
    assert d["education"] == [] and d["skills"] == ["SQL"] and d["certifications"] == []
    assert d["websites"] == ["https://github.com/wren"]


async def test_a_failed_reading_never_logs_the_resume(db_session, test_user, caplog):
    from contextlib import asynccontextmanager

    from app.services import resume_history

    r = await _resume(db_session, test_user, text="SECRET-LINE-123\nEXPERIENCE\n")

    @asynccontextmanager
    async def same_session():
        yield db_session

    def crash(text):
        raise ValueError(text)  # an error carrying the résumé's text

    with (
        patch.object(resume_history, "session_factory", same_session),
        patch("app.services.resume_reader.read", side_effect=crash),
    ):
        await resume_history.read_in_background(r.id)
    assert "SECRET-LINE-123" not in caplog.text
