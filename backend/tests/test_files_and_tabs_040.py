"""Job Catcher's files and tabs (spec 040), the server's half. Invented data.

- The company's own application, seen opening from a job board's listing
  (LinkedIn's "Apply on company website" has no address to read), becomes
  the job's apply link, once; the board's listing stays the listing's link.
- During Apply with Claude, Job Catcher reports that new tab: its site is the
  run's, and Claude's next call carries its address (``new_tab_url``).
- The user writes or pastes their own cover letter for a job: it becomes the
  job's letter, its PDF drawn like Claude's. No AI.
- A résumé's details carry its text, for a "paste your résumé" box.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.mcp_server as mcp_mod
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.apply import ExtensionEvent
from app.services import apply_runs as svc
from app.services import saved_jobs as sj_svc
from app.services.apply_playbook import playbook_text
from tests.test_mcp_server import _connected_user

BOARD = "https://www.linkedin.com/jobs/view/4100000001/"
COMPANY = "https://jobs.northwind.example/en/jobs/77/platform-engineer/apply"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _job(db: AsyncSession, user: User, url: str = BOARD) -> SavedJob:
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=f"x_{uuid.uuid4().hex[:8]}",
        source="manual",
        title="Platform Engineer",
        company="Northwind Labs",
        location="Remote",
        apply_url=url,
        content_hash=uuid.uuid4().hex,
        title_normalized="platform engineer",
        company_normalized="northwind labs",
    )
    db.add(listing)
    await db.flush()
    sj = SavedJob(user_id=user.id, job_listing_id=listing.id)
    db.add(sj)
    await db.commit()
    return sj


# --------------------------------------------------------------------------- #
# The company's own link
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_company_link_is_learned_once_from_the_board(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    sj = await _job(db_session, test_user)
    r = await client.post(f"/v1/saved-jobs/{sj.id}/company-link", json={"url": COMPANY})
    assert r.status_code == 200 and r.json() == {"saved": True}
    summary = (await client.get("/v1/saved-jobs/summary")).json()["jobs"][0]
    # The listing keeps the board's link; the company's is the job's too.
    assert summary["url"] == BOARD
    assert summary["company_url"] == COMPANY
    jobs = (await client.get("/v1/saved-jobs/")).json()
    assert jobs[0]["job_listing"]["apply_url"] == COMPANY

    # Once: a later tab never changes it.
    other = "https://careers.contoso.example/job/1"
    r = await client.post(f"/v1/saved-jobs/{sj.id}/company-link", json={"url": other})
    assert r.json() == {"saved": False}
    await db_session.refresh(sj)
    assert sj.custom_apply_url == COMPANY


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("listing", "url"),
    [
        # The listing is already the company's own: nothing to learn.
        ("https://jobs.northwind.example/jobs/77", COMPANY),
        # Another job board, a LinkedIn page, or not a web page.
        (BOARD, "https://www.indeed.com/viewjob?jk=abc123"),
        (BOARD, "https://www.linkedin.com/company/northwind/"),
        (BOARD, "javascript:alert(1)"),
        (BOARD, "ftp://files.northwind.example/apply"),
        # A link from the posting's text, not an application.
        (BOARD, "https://northwind.example/blog/our-platform-team"),
    ],
)
async def test_only_a_board_listing_learns_a_company_link(
    db_session: AsyncSession, test_user: User, listing: str, url: str
):
    sj = await _job(db_session, test_user, listing)
    assert not await sj_svc.learn_company_link(db_session, test_user.id, sj.id, url)
    await db_session.refresh(sj)
    assert sj.custom_apply_url is None


@pytest.mark.asyncio
async def test_a_link_the_user_set_is_never_replaced(
    db_session: AsyncSession, test_user: User
):
    sj = await _job(db_session, test_user)
    sj.custom_apply_url = "https://my.own.example/apply"
    await db_session.commit()
    assert not await sj_svc.learn_company_link(db_session, test_user.id, sj.id, COMPANY)


@pytest.mark.asyncio
async def test_only_your_own_jobs_learn_a_link(
    client: AsyncClient, db_session: AsyncSession
):
    someone = User(email="someone@test.dev")
    db_session.add(someone)
    await db_session.flush()
    theirs = await _job(db_session, someone)
    r = await client.post(
        f"/v1/saved-jobs/{theirs.id}/company-link", json={"url": COMPANY}
    )
    assert r.json() == {"saved": False}
    await db_session.refresh(theirs)
    assert theirs.custom_apply_url is None


# --------------------------------------------------------------------------- #
# Apply with Claude: the new tab
# --------------------------------------------------------------------------- #


async def _board_run(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch)
    job = await mcp_mod.save_job(
        title="Platform Engineer",
        company="Northwind Labs",
        apply_url=BOARD,
        description="We need Kubernetes and Terraform experience. " * 20,
    )
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
        db.add(
            Resume(
                user_id=user.id,
                filename="me.pdf",
                mime_type="application/pdf",
                file_size_bytes=3,
                extracted_text="Sam Rivera. Kubernetes. Northwind Labs.",
                is_active=True,
            )
        )
        run = await svc.create_run(
            db, user, uuid.UUID(job["job_id"]), mode=svc.APPLY_MODE_KEEP
        )
        await db.commit()
        return maker, user, run.id, uuid.UUID(job["job_id"])


def test_job_catcher_may_report_a_new_tab():
    assert ExtensionEvent(kind="new_tab", url=COMPANY).kind == "new_tab"


@pytest.mark.asyncio
async def test_a_new_tab_is_the_runs_and_claude_hears_its_address(engine, monkeypatch):
    maker, user, run_id, job_id = await _board_run(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    async with maker() as db:
        await svc.extension_event(db, user.id, run_id, "new_tab", COMPANY)
        await db.commit()
    out = await mcp_mod.message_user(rid, "Opening the company's application.")
    assert out["new_tab_url"] == COMPANY
    assert "never ask the user for the address" in out["next"]
    # The address is data: never inside `next`.
    assert COMPANY not in out["next"]
    # Told once.
    again = await mcp_mod.message_user(rid, "Filling it in.")
    assert "new_tab_url" not in again
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id)
        assert "jobs.northwind.example" in run.apply_hosts
        sj = await db.get(SavedJob, job_id)
        assert sj.custom_apply_url == COMPANY
        state = await svc.extension_state(db, user.id)
        assert "jobs.northwind.example" in state["hosts"]


@pytest.mark.asyncio
async def test_a_new_tab_that_isnt_a_web_page_is_ignored(engine, monkeypatch):
    maker, user, run_id, _ = await _board_run(engine, monkeypatch)
    async with maker() as db:
        await svc.extension_event(db, user.id, run_id, "new_tab", "about:blank")
        await db.commit()
        run = await svc.get_run(db, user.id, run_id)
        assert not any(e.get("kind") == "new_tab" for e in run.events or [])


def test_the_playbook_says_the_new_tab_comes_back():
    text = playbook_text()
    assert "new_tab_url" in text
    assert "Never ask the user for the address" in text


# --------------------------------------------------------------------------- #
# Your own cover letter
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_write_your_own_cover_letter_for_a_job(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    sj = await _job(db_session, test_user)
    text = "Hi Jordan,\r\n\r\nThe platform role fits what I do.\r\n\r\nSam Rivera"
    r = await client.post(
        f"/v1/saved-jobs/{sj.id}/cover-letter/write", json={"text": text}
    )
    assert r.status_code == 201
    letter_id = r.json()["id"]
    await db_session.refresh(sj)
    assert str(sj.cover_letter_id) == letter_id
    doc = await db_session.get(GeneratedDocument, uuid.UUID(letter_id))
    assert doc.document_type == "cover_letter" and doc.model_used == "user"
    assert doc.content == text.replace("\r\n", "\n")
    # Job Catcher gets its text and PDF, like Claude's.
    got = (await client.get(f"/v1/autofill/cover-letters/{letter_id}")).json()
    assert got["text"].startswith("Hi Jordan,")
    assert got["pdf_base64"]
    summary = (await client.get("/v1/saved-jobs/summary")).json()["jobs"][0]
    assert summary["cover_letter_id"] == letter_id


@pytest.mark.asyncio
async def test_your_own_letter_needs_words_and_a_job_of_yours(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    sj = await _job(db_session, test_user)
    empty = await client.post(
        f"/v1/saved-jobs/{sj.id}/cover-letter/write", json={"text": "   "}
    )
    assert empty.status_code == 422
    too_long = await client.post(
        f"/v1/saved-jobs/{sj.id}/cover-letter/write", json={"text": "x" * 10_001}
    )
    assert too_long.status_code == 422
    missing = await client.post(
        f"/v1/saved-jobs/{uuid.uuid4()}/cover-letter/write", json={"text": "Hi"}
    )
    assert missing.status_code == 404


# --------------------------------------------------------------------------- #
# The résumé's text
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_resume_details_carry_its_text(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    resume = Resume(
        user_id=test_user.id,
        filename="sam.pdf",
        mime_type="application/pdf",
        file_size_bytes=3,
        extracted_text="  Sam Rivera\nPlatform engineer at Northwind Labs.  ",
        is_active=True,
    )
    db_session.add(resume)
    await db_session.commit()
    body = (await client.get(f"/v1/autofill/resumes/{resume.id}/details")).json()
    assert body["text"] == "Sam Rivera\nPlatform engineer at Northwind Labs."
