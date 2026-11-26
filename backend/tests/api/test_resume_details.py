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


async def test_job_catcher_can_read_but_not_edit(
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


async def test_your_usual_resume_on_purpose_beats_the_resume_types(
    client: AsyncClient, db_session, test_user
):
    """A job whose résumé type has a résumé: picking "your usual résumé" sticks."""
    from app.models.resume_track import ResumeTrack
    from app.models.saved_job import SavedJob

    typed = await _resume(db_session, test_user, name="type.pdf")
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://careers.example/jobs/9",
                "title": "Analyst",
                "company": "Kelso Labs",
            },
        )
    ).json()
    track = ResumeTrack(user_id=test_user.id, name="Data", resume_id=typed.id)
    db_session.add(track)
    await db_session.flush()
    sj = await db_session.get(SavedJob, uuid.UUID(saved["id"]))
    sj.track_id = track.id
    await db_session.commit()
    jobs = (await client.get("/v1/saved-jobs/summary")).json()["jobs"]
    assert jobs[0]["resume_id"] == str(typed.id)  # the résumé type's

    await client.put(
        f"/v1/saved-jobs/{saved['id']}/resume", json={"resume_id": None, "usual": True}
    )
    jobs = (await client.get("/v1/saved-jobs/summary")).json()["jobs"]
    assert jobs[0]["resume_id"] is None and jobs[0]["resume_usual"] is True


async def test_promotion_is_recorded_once_per_account(
    client: AsyncClient, db_session, test_user
):
    assert (await client.get("/v1/autofill/bundle")).json()["promoted"] is False
    assert (await client.post("/v1/autofill/promoted")).status_code == 204
    assert (await client.get("/v1/autofill/bundle")).json()["promoted"] is True


async def test_work_history_from_the_chosen_resume(
    client: AsyncClient, db_session, test_user
):
    active = await _resume(db_session, test_user, name="usual.pdf")
    active.is_active = True
    other = await _resume(
        db_session,
        test_user,
        name="data.pdf",
        text="EXPERIENCE\nData Analyst | Opaline Pay | 2021 - 2023\n",
    )
    await db_session.commit()
    usual = (await client.post("/v1/ai/work-history", json={})).json()["entries"]
    chosen = (
        await client.post(f"/v1/ai/work-history?resume_id={other.id}", json={})
    ).json()["entries"]
    assert usual[0]["company"] == "Tidewell Labs"
    assert chosen[0]["company"] == "Opaline Pay"


async def test_job_catcher_can_read_a_chosen_resume_that_was_never_read(
    anon_client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user)
    auth = {"Authorization": f"Bearer {await _a_pass(db_session, test_user)}"}
    got = await anon_client.post(f"/v1/autofill/resumes/{r.id}/read", headers=auth)
    assert got.status_code == 200 and got.json()["read"] is True


async def test_a_pass_never_overwrites_details_edited_in_the_app(
    client: AsyncClient, anon_client: AsyncClient, db_session, test_user
):
    """A stolen pass can't wipe the user's edits: it may only read a résumé
    that was never read. The app's Read my résumé still re-reads."""
    r = await _resume(db_session, test_user)
    edited = {"work": [{"title": "My own title", "company": "Kelso Labs"}]}
    await client.put(f"/v1/autofill/resumes/{r.id}/details", json=edited)
    auth = {"Authorization": f"Bearer {await _a_pass(db_session, test_user)}"}
    got = (
        await anon_client.post(f"/v1/autofill/resumes/{r.id}/read", headers=auth)
    ).json()
    assert got["work"][0]["title"] == "My own title"
    again = (await client.post(f"/v1/autofill/resumes/{r.id}/read")).json()
    assert again["work"][0]["company"] == "Tidewell Labs"  # re-read from the file


JOB_RESUME = """# Alex Rivera
Portland, OR · alex@example.com

## WORK EXPERIENCE
**Platform Engineer** · Northwind Labs | Mar 2023 – Present
### Cloud
- Moved the build servers to containers with zero downtime.
- Cut cloud costs by a third.

## EDUCATION
**Lakeview College** | *B.S. Computer Science* | 2016 – 2020
"""


async def _job_resume(db: AsyncSession, user: User, *, read_at, edited=False):
    from app.models.generated_document import GeneratedDocument

    doc = GeneratedDocument(user_id=user.id, document_type="resume", content=JOB_RESUME)
    db.add(doc)
    await db.flush()
    r = Resume(
        id=uuid.uuid4(),
        user_id=user.id,
        filename="Alex Rivera - Résumé.pdf",
        mime_type="application/pdf",
        file_size_bytes=4,
        file_data=b"%PDF",
        extracted_text="Alex Rivera Platform Engineer",
        is_active=False,
        document_id=doc.id,
        # The master's details, borrowed (spec 022–028): its PDF's broken lines.
        parsed_history={
            "work": [
                {
                    "title": "Platform Engineer",
                    "company": "Northwind Labs",
                    "description": "Moved the build servers to\ncontainers with zero",
                }
            ]
        },
        parsed_history_at=read_at,
    )
    db.add(r)
    await db.commit()
    return r


async def test_a_job_resume_reads_its_own_details_not_the_masters(
    client: AsyncClient, db_session, test_user
):
    """Spec 029: a résumé made for a job used to carry the master résumé's
    details, so Workday got the master's PDF text, broken mid-sentence."""
    from datetime import UTC, datetime, timedelta

    old = datetime.now(tz=UTC) - timedelta(days=30)  # the master's reading
    r = await _job_resume(db_session, test_user, read_at=old)
    d = (await client.get(f"/v1/autofill/resumes/{r.id}/details")).json()
    assert d["read"] is True
    [job] = d["work"]
    assert (job["title"], job["company"]) == ("Platform Engineer", "Northwind Labs")
    assert job["description"] == (
        "• Moved the build servers to containers with zero downtime.\n"
        "• Cut cloud costs by a third."
    )
    assert d["education"][0]["school"] == "Lakeview College"
    # Job Catcher's older path asks for the work history the same way.
    work = (await client.post(f"/v1/ai/work-history?resume_id={r.id}")).json()
    assert work["entries"][0]["description"].startswith("• Moved the build servers")


async def test_details_the_user_edited_on_a_job_resume_are_kept(
    client: AsyncClient, db_session, test_user
):
    from datetime import UTC, datetime, timedelta

    later = datetime.now(tz=UTC) + timedelta(minutes=5)  # edited after it was made
    r = await _job_resume(db_session, test_user, read_at=later)
    d = (await client.get(f"/v1/autofill/resumes/{r.id}/details")).json()
    assert (
        d["work"][0]["description"]
        == "Moved the build servers to\ncontainers with zero"
    )


PDF_TEXT = (
    "EXPERIENCE\n"
    "Platform Engineer | Northwind Labs | Mar 2020 - Jan 2023\n"
    "- Kept every secret in a managed key store, with the audit trail in\n"
    "Cloud Logbook.\n"
    "- Ran the build servers\n"
)


async def _old_read(db: AsyncSession, user: User, *, work=None) -> Resume:
    """A résumé read before spec 029: no marks, the old reader's jobs."""
    from datetime import UTC, datetime

    from app.services import resume_reader_v1

    r = await _resume(db, user, text=PDF_TEXT)
    r.is_active = True
    r.parsed_history = {
        "work": work if work is not None else resume_reader_v1.work(PDF_TEXT),
        "education": [],
        "skills": ["SQL"],
        "certifications": [],
        "websites": [],
    }
    r.parsed_history_at = datetime(2026, 11, 1, tzinfo=UTC)
    await db.commit()
    return r


async def test_an_old_reading_never_edited_is_read_again_once(
    client: AsyncClient, db_session, test_user
):
    from app.services import resume_reader_v1

    # The old reader lost "Cloud Logbook." (a short wrapped line).
    old = resume_reader_v1.work(PDF_TEXT)
    assert "Cloud Logbook" not in old[0]["description"]
    r = await _old_read(db_session, test_user)
    d = (await client.get(f"/v1/autofill/resumes/{r.id}/details")).json()
    assert d["work"][0]["description"] == (
        "• Kept every secret in a managed key store, with the audit trail in "
        "Cloud Logbook.\n• Ran the build servers"
    )
    assert d["skills"] == ["SQL"]  # the rest is kept as it was
    await db_session.refresh(r)
    assert r.parsed_history["reader"] == 2 and "edited" not in r.parsed_history


async def test_an_old_reading_the_user_edited_is_never_replaced(
    client: AsyncClient, db_session, test_user
):
    mine = [
        {
            "title": "Platform Engineer",
            "company": "Northwind Labs",
            "description": "My words",
        }
    ]
    r = await _old_read(db_session, test_user, work=mine)
    d = (await client.get(f"/v1/autofill/resumes/{r.id}/details")).json()
    assert d["work"][0]["description"] == "My words"
    await db_session.refresh(r)
    assert r.parsed_history["edited"] is True
    # The bundle and the work history leave it too.
    b = (await client.get("/v1/autofill/bundle")).json()
    assert b["history"]["work"][0]["description"] == "My words"
    assert "edited" not in b["history"] and "reader" not in b["history"]


async def test_the_bundle_reads_an_old_usual_resume_again(
    client: AsyncClient, db_session, test_user
):
    await _old_read(db_session, test_user)
    b = (await client.get("/v1/autofill/bundle")).json()
    assert "Cloud Logbook." in b["history"]["work"][0]["description"]


async def test_details_edited_in_the_app_are_marked_the_users(
    client: AsyncClient, db_session, test_user
):
    r = await _resume(db_session, test_user)
    body = {"work": [{"title": "Analyst", "company": "Kelso Labs"}]}
    await client.put(f"/v1/autofill/resumes/{r.id}/details", json=body)
    await db_session.refresh(r)
    assert r.parsed_history["edited"] is True


async def test_editing_a_job_resume_keeps_the_details_the_user_edited(
    client: AsyncClient, db_session, test_user
):
    """Review: rerender used to replace edited details with a new reading."""
    from datetime import UTC, datetime

    from app.models.generated_document import GeneratedDocument
    from app.services import apply_resume

    r = await _job_resume(db_session, test_user, read_at=datetime.now(tz=UTC))
    doc = await db_session.get(GeneratedDocument, r.document_id)
    # The user edits the details in the app, then edits the document.
    body = {"work": [{"title": "Lead Engineer", "company": "Northwind Labs"}]}
    await client.put(f"/v1/autofill/resumes/{r.id}/details", json=body)
    doc.edited_content = JOB_RESUME.replace("Cut cloud costs", "Halved cloud costs")
    await apply_resume.rerender(db_session, doc)
    await db_session.commit()
    await db_session.refresh(r)
    assert r.parsed_history["work"][0]["title"] == "Lead Engineer"


async def test_editing_a_job_resume_rereads_details_nobody_edited(
    db_session, test_user
):
    from datetime import UTC, datetime, timedelta

    from app.models.generated_document import GeneratedDocument
    from app.services import apply_resume

    old = datetime.now(tz=UTC) - timedelta(days=3)
    r = await _job_resume(db_session, test_user, read_at=old)
    doc = await db_session.get(GeneratedDocument, r.document_id)
    doc.edited_content = JOB_RESUME.replace("Cut cloud costs", "Halved cloud costs")
    await apply_resume.rerender(db_session, doc)
    await db_session.commit()
    await db_session.refresh(r)
    assert "Halved cloud costs" in r.parsed_history["work"][0]["description"]
    assert r.parsed_history["reader"] == 2
