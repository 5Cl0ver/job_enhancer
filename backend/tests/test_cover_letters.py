"""Cover letters, like résumés (spec 031): Claude writes a short one when an
application asks for it, the app draws it in the résumé's look, each job
picks the one that goes with it, and Job Catcher gets its text and PDF."""

import base64
import io
import sqlite3
import uuid

import pdfplumber
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.mcp_server as mcp_mod
from app.models.application_profile import ApplicationProfile
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import apply_runs as svc
from app.services import cover_letters
from app.services.apply_playbook import playbook_text
from app.services.resume_pdf import MUTED, NAVY, render_letter_pdf
from tests.test_mcp_apply import RESUME, _run, _setup
from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "y3b4c5d6e7f9", "z4c5d6e7f8a0"

LETTER = (
    "The IT Systems Engineer role at Acme is the work I've been doing for "
    "three years: keeping Intune, Okta and a few hundred laptops running "
    "smoothly for a growing team.\n\n"
    "At Northwind Labs I moved 400 devices to Intune and wrote the PowerShell "
    "that set up new hires in minutes instead of a day.\n\n"
    "I'd like to bring that to Acme's IT team.\n\n"
    "Thanks for your time,\nSam Rivera"
)


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


# --------------------------------------------------------------------------- #
# The rules Claude's letter must follow
# --------------------------------------------------------------------------- #


def test_a_good_letter_passes():
    assert cover_letters.check_letter(f"  {LETTER}\n") == LETTER


@pytest.mark.parametrize(
    ("letter", "reason"),
    [
        ("Dear Hiring Manager,\n\n" + LETTER, 'No "Dear'),
        ("Dear Sir/Madam,\n\n" + LETTER, 'No "Dear'),
        ("To whom it may concern,\n\n" + LETTER, "To whom it may concern"),
        (LETTER + "\n\nI am writing to express my interest.", "I am writing"),
        ("# Sam Rivera\n\n" + LETTER, "only the letter"),
        (LETTER.replace("Acme's", "[Company]'s"), "placeholder"),
        ("Short.", "too short"),
        (LETTER + "\n\n" + "more words here " * 120, "250 words"),
        # Markdown, a "Re:" line, a name or contact header, or a date never
        # hides a stiff opening.
        ("**Dear Hiring Manager,**\n\n" + LETTER, 'No "Dear'),
        ("__Dear Jordan__,\n\n" + LETTER, 'No "Dear'),
        (
            "Re: Platform Engineer\nNovember 25, 2026\n\nDear Jordan,\n\n" + LETTER,
            'No "Dear',
        ),
        (
            "Sam Rivera\nsam@example.com · Portland, OR\n\nTo whom it may concern,\n\n"
            + LETTER,
            "To whom",
        ),
        ("2026-11-25\n\nDear Hiring Manager\n\n" + LETTER, 'No "Dear'),
        ("Hi team,\n\n" + LETTER, "Hi team"),
        ("Hello hiring manager,\n\n" + LETTER, "Hi team"),
        ("Hi there!\n\n" + LETTER, "Hi team"),
        ("Greetings,\n\n" + LETTER, "Hi team"),
        (LETTER + "\n\nI'm writing to apply for the role.", "I am writing"),
        (LETTER + "\n\nI’m writing to express my interest.", "I am writing"),
    ],
)
def test_stiff_or_wrong_letters_are_sent_back(letter, reason):
    with pytest.raises(ValueError, match=reason):
        cover_letters.check_letter(letter)


@pytest.mark.parametrize(
    "opening",
    [
        "Hi Jordan,",
        "Hello Jordan,",
        "Greetings from Portland: the platform work at Acme is what I do best.",
        "Re: Platform Engineer",
    ],
)
def test_a_named_greeting_or_a_real_sentence_is_fine(opening):
    assert cover_letters.check_letter(f"{opening}\n\n{LETTER}").startswith(opening)


# --------------------------------------------------------------------------- #
# The PDF
# --------------------------------------------------------------------------- #


def _rgb(color) -> tuple[int, ...]:
    return tuple(round(c * 255) for c in (color or ()))


def test_the_letter_pdf_has_the_resume_header_then_the_letter():
    data = render_letter_pdf(
        "# Sam Rivera\n> IT Systems Engineer\nPortland, OR · sam@example.com",
        LETTER,
        "November 25, 2026",
    )
    with pdfplumber.open(io.BytesIO(data)) as doc:
        assert len(doc.pages) == 1
        page = doc.pages[0]
        words = page.extract_words(extra_attrs=["size", "non_stroking_color"])
        text = page.extract_text()
        fills = [_rgb(r.get("non_stroking_color")) for r in page.rects if r.get("fill")]
    name = next(w for w in words if w["text"] == "Sam")
    assert round(name["size"]) == 24 and _rgb(name["non_stroking_color"]) == NAVY
    assert NAVY in fills  # the header's navy rule
    date = next(w for w in words if w["text"] == "November")
    assert _rgb(date["non_stroking_color"]) == MUTED
    # In reading order: header, date, letter, then the sign-off on two lines.
    assert text.index("Sam Rivera") < text.index("November 25, 2026")
    assert text.index("November 25, 2026") < text.index("The IT Systems Engineer")
    assert text.rstrip().endswith("Thanks for your time,\nSam Rivera")
    assert "Page 1" not in text  # one page: no footer


def test_a_letter_with_no_header_still_renders():
    with pdfplumber.open(io.BytesIO(render_letter_pdf("", LETTER))) as doc:
        assert "Northwind Labs" in doc.pages[0].extract_text()


def test_resume_header_is_everything_before_the_first_section():
    assert cover_letters.resume_header(RESUME).startswith("# Sam Rivera")
    assert "## " not in cover_letters.resume_header(RESUME)
    assert cover_letters.resume_header("Just text\n## SKILLS") == ""


# --------------------------------------------------------------------------- #
# Claude writes it in a run
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_claude_saves_a_letter_and_job_catcher_gets_it(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    brief = await mcp_mod.get_apply_brief(rid)
    assert brief["cover_letter_text"] is None
    assert "save_cover_letter" in brief["playbook"]

    with pytest.raises(ValueError, match="Dear"):
        await mcp_mod.save_cover_letter(rid, "Dear Hiring Manager,\n\n" + LETTER)
    saved = await mcp_mod.save_cover_letter(rid, LETTER)
    assert "fill_page" in saved["next"]
    letter_id = uuid.UUID(saved["cover_letter_id"])

    async with maker() as db:
        sj = await db.get(SavedJob, job_id)
        assert sj.cover_letter_id == letter_id
        run = await svc.get_run(db, user.id, run_id)
        assert run.cover_letter_id == letter_id
        assert run.status == "reading"  # writing a letter never moves the step
        state = await svc.extension_state(db, user.id)
        assert state["cover_letter_id"] == str(letter_id)
        shown = await svc.view(db, run)
        assert shown["cover_letter"]["id"] == str(letter_id)
        assert shown["cover_letter"]["filename"] == "Cover letter.pdf"
        doc = await db.get(GeneratedDocument, letter_id)
        assert (doc.document_type, doc.model_used) == (
            "cover_letter",
            "claude-connector",
        )

    # Saved again in the same run: the same letter, replaced.
    again = await mcp_mod.save_cover_letter(rid, LETTER.replace("400", "450"))
    assert again["cover_letter_id"] == str(letter_id)
    brief = await mcp_mod.get_apply_brief(rid)
    assert "450 devices" in brief["cover_letter_text"]
    assert (await _run(maker, run_id)).events[-2]["kind"] == "cover_letter"


@pytest.mark.asyncio
async def test_a_letter_the_user_picked_is_never_written_over(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        mine = GeneratedDocument(
            user_id=user.id, document_type="cover_letter", content="My own letter."
        )
        db.add(mine)
        await db.flush()
        await cover_letters.set_for_job(db, user.id, job_id, mine.id)
        await db.commit()
        mine_id = mine.id
        assert (await svc.extension_state(db, user.id))["cover_letter_id"] == str(
            mine_id
        )
    brief = await mcp_mod.get_apply_brief(str(run_id))
    assert brief["cover_letter_text"] == "My own letter."

    # Claude writes one anyway: it's saved on the run, but the user's stays
    # the job's letter, and Claude is told so.
    saved = await mcp_mod.save_cover_letter(str(run_id), LETTER)
    assert saved["cover_letter_id"] != str(mine_id)
    assert saved["attached"] is False
    assert "it won't be attached" in saved["note"]
    async with maker() as db:
        assert (await db.get(GeneratedDocument, mine_id)).content == "My own letter."
        assert (await db.get(SavedJob, job_id)).cover_letter_id == mine_id
        run = await svc.get_run(db, user.id, run_id)
        assert run.cover_letter_id == uuid.UUID(saved["cover_letter_id"])
        state = await svc.extension_state(db, user.id)
        assert state["cover_letter_id"] == str(mine_id)


@pytest.mark.asyncio
async def test_not_while_the_user_reviews_the_application(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        run.status = "review"
        await db.commit()
    with pytest.raises(ValueError, match="with the user"):
        await mcp_mod.save_cover_letter(str(run_id), LETTER)


@pytest.mark.asyncio
async def test_your_pick_wins_over_claudes_letter_mid_run(engine, monkeypatch):
    """Claude saves a letter, then the user picks None (or another letter) on
    the job page: nothing (or theirs) is attached for that run."""
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    saved = await mcp_mod.save_cover_letter(rid, LETTER)
    async with maker() as db:
        await cover_letters.set_for_job(db, user.id, job_id, None)
        await db.commit()
        run = await svc.get_run(db, user.id, run_id)
        assert run.cover_letter_id == uuid.UUID(saved["cover_letter_id"])  # recorded
        assert (await svc.extension_state(db, user.id))["cover_letter_id"] is None
        shown = await svc.view(db, run)
        assert shown["cover_letter"] is None and shown["cover_letter_written"] is True
    assert (await mcp_mod.get_apply_brief(rid))["cover_letter_text"] is None

    async with maker() as db:
        mine = GeneratedDocument(
            user_id=user.id, document_type="cover_letter", content="My own letter."
        )
        db.add(mine)
        await db.flush()
        await cover_letters.set_for_job(db, user.id, job_id, mine.id)
        await db.commit()
        state = await svc.extension_state(db, user.id)
        assert state["cover_letter_id"] == str(mine.id)
        run = await svc.get_run(db, user.id, run_id)
        assert (await svc.view(db, run))["cover_letter"]["id"] == str(mine.id)

    # Claude saving again replaces its own letter and makes it the pick again.
    # Claude saving again only updates its own letter: the user's pick stays.
    again = await mcp_mod.save_cover_letter(rid, LETTER.replace("400", "450"))
    assert again["cover_letter_id"] == saved["cover_letter_id"]
    assert again["attached"] is False
    assert "it won't be attached" in again["note"]
    async with maker() as db:
        assert (await db.get(GeneratedDocument, mine.id)).content == "My own letter."
        assert (await db.get(SavedJob, job_id)).cover_letter_id == mine.id
        claudes = await db.get(GeneratedDocument, uuid.UUID(saved["cover_letter_id"]))
        assert "450 devices" in claudes.content  # the new text is still kept


@pytest.mark.asyncio
async def test_none_chosen_mid_run_stays_none_when_claude_saves_again(
    engine, monkeypatch
):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    first = await mcp_mod.save_cover_letter(rid, LETTER)
    assert first["attached"] is True
    async with maker() as db:
        await cover_letters.set_for_job(db, user.id, job_id, None)
        await db.commit()
    again = await mcp_mod.save_cover_letter(rid, LETTER.replace("400", "450"))
    assert again["attached"] is False
    async with maker() as db:
        assert (await db.get(SavedJob, job_id)).cover_letter_id is None
        assert (await svc.extension_state(db, user.id))["cover_letter_id"] is None
        run = await svc.get_run(db, user.id, run_id)
        assert (await svc.view(db, run))["cover_letter"] is None


@pytest.mark.asyncio
async def test_while_the_job_still_has_claudes_letter_a_new_save_replaces_it(
    engine, monkeypatch
):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    first = await mcp_mod.save_cover_letter(rid, LETTER)
    again = await mcp_mod.save_cover_letter(rid, LETTER.replace("400", "450"))
    assert again["attached"] is True and "fill_page" in again["next"]
    async with maker() as db:
        sj = await db.get(SavedJob, job_id)
        assert str(sj.cover_letter_id) == first["cover_letter_id"]


@pytest.mark.asyncio
async def test_save_draft_follows_the_cover_letter_rules(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    with pytest.raises(ValueError, match='No "Dear'):
        await mcp_mod.save_draft(str(job_id), "cover_letter", "Dear Sir,\n\n" + LETTER)
    with pytest.raises(ValueError, match="too short"):
        await mcp_mod.save_draft(str(job_id), "cover_letter", "Short.")
    ok = await mcp_mod.save_draft(str(job_id), "cover_letter", LETTER)
    assert ok["document_type"] == "cover_letter"
    # A résumé draft is unchanged by the letter rules.
    assert (await mcp_mod.save_draft(str(job_id), "resume", "Dear résumé"))["draft_id"]


@pytest.mark.asyncio
async def test_the_tool_and_the_playbook_rules():
    tools = {t.name: t for t in await mcp_mod.mcp.list_tools()}
    assert "save_cover_letter" in tools
    assert "ONLY when" in tools["save_cover_letter"].description
    text = playbook_text()
    assert "under about 250 words" in text
    assert "To whom it may concern" in text
    assert '"Hi <name>," only when' in text
    assert "Never put a cover letter in the résumé box" in text


# --------------------------------------------------------------------------- #
# The app's routes
# --------------------------------------------------------------------------- #


async def _job_and_letter(db: AsyncSession, user: User, **letter):
    job = JobListing(
        id=uuid.uuid4(),
        external_id=f"x_{uuid.uuid4().hex[:8]}",
        source="manual",
        title="Platform Engineer",
        company="Northwind Labs",
        location="Remote",
        apply_url="https://example.com/apply",
        content_hash=uuid.uuid4().hex,
        title_normalized="platform engineer",
        company_normalized="northwind labs",
    )
    db.add(job)
    await db.flush()
    sj = SavedJob(user_id=user.id, job_listing_id=job.id)
    doc = GeneratedDocument(
        user_id=user.id,
        job_listing_id=job.id,
        document_type="cover_letter",
        content=letter.get("content", LETTER),
    )
    db.add_all([sj, doc])
    db.add(
        ApplicationProfile(
            user_id=user.id,
            first_name="Alex",
            last_name="Rivera",
            city="Portland",
            state="OR",
            linkedin_url="https://www.linkedin.com/in/alex-rivera/",
        )
    )
    await db.commit()
    return sj, doc


@pytest.mark.asyncio
async def test_pick_view_and_edit_a_letter(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    sj, doc = await _job_and_letter(db_session, test_user)

    listed = (await client.get("/v1/ai/cover-letters")).json()
    assert [x["id"] for x in listed] == [str(doc.id)]
    assert (listed[0]["company"], listed[0]["job_title"]) == (
        "Northwind Labs",
        "Platform Engineer",
    )

    put = await client.put(
        f"/v1/saved-jobs/{sj.id}/cover-letter", json={"cover_letter_id": str(doc.id)}
    )
    assert put.status_code == 204
    jobs = (await client.get("/v1/saved-jobs/")).json()
    assert jobs[0]["cover_letter_id"] == str(doc.id)
    summary = (await client.get("/v1/saved-jobs/summary")).json()
    assert summary["jobs"][0]["cover_letter_id"] == str(doc.id)

    pdf = await client.get(f"/v1/ai/documents/{doc.id}/pdf")
    assert pdf.status_code == 200
    assert (
        "Alex%20Rivera%20-%20Cover%20letter.pdf" in pdf.headers["content-disposition"]
    )
    with pdfplumber.open(io.BytesIO(pdf.content)) as file:
        text = file.pages[0].extract_text()
    # The profile's name and contact on top, in the résumé's look.
    assert text.startswith("Alex Rivera")
    assert "Portland, OR · user@test.dev · linkedin.com/in/alex-rivera" in text

    # Edit the text: the PDF is remade from it.
    edited = await client.patch(
        f"/v1/ai/documents/{doc.id}", json={"edited_content": "A shorter letter."}
    )
    assert edited.status_code == 200
    pdf = await client.get(f"/v1/ai/documents/{doc.id}/pdf")
    with pdfplumber.open(io.BytesIO(pdf.content)) as file:
        assert "A shorter letter." in file.pages[0].extract_text()
    too_long = await client.patch(
        f"/v1/ai/documents/{doc.id}", json={"edited_content": "x" * 10_001}
    )
    assert too_long.status_code == 422

    # None: the job has no cover letter.
    put = await client.put(
        f"/v1/saved-jobs/{sj.id}/cover-letter", json={"cover_letter_id": None}
    )
    assert put.status_code == 204
    await db_session.refresh(sj)
    assert sj.cover_letter_id is None


@pytest.mark.asyncio
async def test_the_header_comes_from_the_jobs_resume_when_claude_made_one(
    db_session: AsyncSession, test_user: User
):
    from app.models.resume import Resume

    sj, doc = await _job_and_letter(db_session, test_user)
    made = GeneratedDocument(
        user_id=test_user.id, document_type="resume", content=RESUME
    )
    db_session.add(made)
    await db_session.flush()
    resume = Resume(
        user_id=test_user.id,
        filename="r.pdf",
        mime_type="application/pdf",
        file_size_bytes=1,
        is_active=False,
        document_id=made.id,
    )
    db_session.add(resume)
    await db_session.flush()
    sj.resume_id = resume.id
    await db_session.commit()
    data, name = await cover_letters.pdf_of(db_session, doc)
    assert name == "Alex Rivera - Cover letter.pdf"
    with pdfplumber.open(io.BytesIO(data)) as file:
        assert file.pages[0].extract_text().startswith("Sam Rivera")


@pytest.mark.asyncio
async def test_only_your_own_cover_letters(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    from app.services.users import create_user

    sj, _ = await _job_and_letter(db_session, test_user)
    other = await create_user(db_session, email="other@test.dev", name="Other")
    theirs = GeneratedDocument(
        user_id=other.id, document_type="cover_letter", content=LETTER
    )
    a_resume = GeneratedDocument(
        user_id=test_user.id, document_type="resume", content=RESUME
    )
    db_session.add_all([theirs, a_resume])
    await db_session.commit()

    for bad in (theirs.id, a_resume.id, uuid.uuid4()):
        put = await client.put(
            f"/v1/saved-jobs/{sj.id}/cover-letter", json={"cover_letter_id": str(bad)}
        )
        assert put.status_code == 404
    assert (
        await client.get(f"/v1/autofill/cover-letters/{theirs.id}")
    ).status_code == 404
    assert (
        await client.get(f"/v1/autofill/cover-letters/{a_resume.id}")
    ).status_code == 404
    assert (await client.get(f"/v1/ai/documents/{theirs.id}/pdf")).status_code == 404


@pytest.mark.asyncio
async def test_job_catcher_gets_the_text_and_the_pdf(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    _, doc = await _job_and_letter(db_session, test_user)
    got = await client.get(f"/v1/autofill/cover-letters/{doc.id}")
    assert got.status_code == 200
    body = got.json()
    assert body["text"] == LETTER
    assert body["filename"] == "Alex Rivera - Cover letter.pdf"
    assert base64.b64decode(body["pdf_base64"]).startswith(b"%PDF")


@pytest.mark.asyncio
async def test_a_user_with_no_letters_lists_none(client: AsyncClient):
    assert (await client.get("/v1/ai/cover-letters")).json() == []


# --------------------------------------------------------------------------- #
# The migration
# --------------------------------------------------------------------------- #


def test_migration_round_trip(tmp_path):
    db = tmp_path / "letters.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE generated_documents (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE saved_jobs (id CHAR(32) PRIMARY KEY, resume_id CHAR(32));"
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO saved_jobs VALUES ('" + "a" * 32 + "', NULL);"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    for table in ("saved_jobs", "apply_runs"):
        cols = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        assert "cover_letter_id" in cols
        fks = list(con.execute(f"PRAGMA foreign_key_list({table})"))
        assert any(f[2] == "generated_documents" and f[6] == "SET NULL" for f in fks)
        indexes = {r[1] for r in con.execute(f"PRAGMA index_list({table})")}
        assert f"ix_{table}_cover_letter_id" in indexes
    assert con.execute("SELECT count(*) FROM saved_jobs").fetchone() == (1,)
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(saved_jobs)")}
    assert "cover_letter_id" not in cols
    assert con.execute("SELECT count(*) FROM saved_jobs").fetchone() == (1,)
    con.close()


def test_migration_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "ALTER TABLE saved_jobs ADD COLUMN cover_letter_id UUID" in up
    assert "ALTER TABLE apply_runs ADD COLUMN cover_letter_id UUID" in up
    assert up.count("REFERENCES generated_documents (id) ON DELETE SET NULL") == 2
    assert "CREATE INDEX ix_saved_jobs_cover_letter_id ON saved_jobs" in up
    assert "CREATE INDEX ix_apply_runs_cover_letter_id ON apply_runs" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN cover_letter_id" in down
    assert "DROP INDEX ix_saved_jobs_cover_letter_id" in down
