"""Claude Scout through the connector, the way Claude in Chrome calls it.

The rules under test (research R8, R9): replies stay small however big the
tracker gets, Claude never sends job text, and the job saved is the exact page
copy the extension captured. Invented companies throughout.
"""

import json
import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.collection import Collection
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.models.scout import ScoutFinding, ScoutRun
from app.models.user import User
from app.schemas.scout import CaptureIn, MissionCreate, TrackCreate
from app.services import job_source, scout_runs, scout_tracks
from app.services import saved_jobs as sj_svc
from tests.test_mcp_server import _connected_user

POSTING = (
    "About the job\n"
    "Brambleworks is hiring an IT Systems Administrator to run Microsoft 365 and "
    "Entra ID for 400 staff.\n\n"
    "Responsibilities\n- Manage users and devices in Intune\n- Automate onboarding\n\n"
    "Requirements\n- 3+ years administering Microsoft 365\n- PowerShell\n"
)
JOB_URL = "https://www.linkedin.com/jobs/view/4012345678/?trk=public_jobs"


async def _setup(
    maker, email, *, exclude=(), min_pay=None, job_count=2, auto_save=False
):
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == email))
        track = await scout_tracks.create_track(
            db,
            user.id,
            TrackCreate(
                name="IT Admin",
                target_titles=["IT Systems Administrator", "Jira Administrator"],
                key_skills=["Microsoft 365", "Entra ID"],
                skip_rules={"exclude": list(exclude)},
                min_pay=min_pay,
            ),
        )
        mission = await scout_runs.create_mission(
            db,
            user.id,
            MissionCreate(
                source="linkedin",
                track_id=track.id,
                job_count=job_count,
                location="Springfield, IL",
                auto_save=auto_save,
            ),
        )
        run = await scout_runs.queue_run(db, mission.id, user.id)
        await db.commit()
        return user.id, track.id, run.id


async def _capture(maker, user_id, url=JOB_URL, **kw):
    data = {
        "url": url,
        "title": "IT Systems Administrator",
        "company": "Brambleworks, Inc.",
        "location": "Springfield, IL",
        "description": POSTING,
        "salary_min": 72000,
        "salary_max": 85000,
        "salary_period": "yearly",
        "via": "linkedin",
        **kw,
    }
    async with maker() as db:
        stored = await scout_runs.record_capture(db, user_id, CaptureIn(**data))
        await db.commit()
        return stored


async def _track_job(maker, user_id, company, title):
    async with maker() as db:
        listing = JobListing(
            id=uuid.uuid4(),
            external_id=uuid.uuid4().hex,
            source="test",
            title=title,
            company=company,
            location="Springfield, IL",
            apply_url="https://vellacor.example/jobs/1",
            content_hash=uuid.uuid4().hex,
            company_normalized=company.lower(),
            title_normalized=title.lower(),
        )
        db.add(listing)
        await db.flush()
        db.add(SavedJob(id=uuid.uuid4(), user_id=user_id, job_listing_id=listing.id))
        await db.commit()


@pytest.mark.asyncio
class TestBrief:
    async def test_picks_the_queued_run_and_marks_it_running(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="brief@test.dev")
        _, _, run_id = await _setup(maker, "brief@test.dev")
        out = await mcp_mod.get_scout_brief()
        assert out["run_id"] == str(run_id)
        assert out["track"]["titles"][0] == "IT Systems Administrator"
        url = out["start_urls"][0]
        assert url.startswith("https://www.linkedin.com/jobs/search/?")
        assert "f_TPR=r604800" in url and "sortBy=DD" in url
        assert out["progress"] == {"kept": 0, "target": 2, "done": False}
        # Claude is told it doesn't save: the user confirms in the app.
        assert "for the user to tick and save" in out["saving"]
        async with maker() as db:
            assert (await db.get(ScoutRun, run_id)).status == "running"

    async def test_no_run_waiting_says_what_to_do(self, engine, monkeypatch):
        await _connected_user(engine, monkeypatch, email="none@test.dev")
        with pytest.raises(ValueError, match="press Start"):
            await mcp_mod.get_scout_brief()

    async def test_brief_does_not_grow_with_the_tracker(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="size@test.dev")
        user_id, _, _ = await _setup(maker, "size@test.dev")
        small = len(json.dumps(await mcp_mod.get_scout_brief()))
        for i in range(150):
            await _track_job(maker, user_id, f"Vellacor {i}", f"Analyst {i}")
        big = len(json.dumps(await mcp_mod.get_scout_brief()))
        assert big == small
        assert small < 6000  # characters, i.e. roughly 1.5k tokens


@pytest.mark.asyncio
class TestCheckJobs:
    async def test_only_new_rows_come_back(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="check@test.dev")
        user_id, _, run_id = await _setup(
            maker, "check@test.dev", exclude=["Clearance"]
        )
        await _track_job(maker, user_id, "Vellacor LLC", "Jira Administrator")
        await mcp_mod.get_scout_brief()
        rows = [
            {"company": "Vellacor", "title": "Jira Administrator", "url": ""},
            {"company": "Brambleworks", "title": "IT Systems Administrator"},
            {"company": "Quillstone", "title": "IT Administrator (Clearance)"},
        ]
        out = await mcp_mod.check_jobs(str(run_id), rows)
        assert out["open"] == [1]
        assert out["skipped"] == {"in_tracker": 1, "seen_before": 0, "excluded": 1}

    async def test_too_many_rows_is_refused(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="many@test.dev")
        _, _, run_id = await _setup(maker, "many@test.dev")
        await mcp_mod.get_scout_brief()
        rows = [{"company": f"C{i}", "title": "T"} for i in range(31)]
        with pytest.raises(ValueError, match="at most 30"):
            await mcp_mod.check_jobs(str(run_id), rows)


@pytest.mark.asyncio
class TestReportJob:
    async def test_saves_the_exact_page_copy_with_the_resume_type(
        self, engine, monkeypatch
    ):
        """A search set to save without asking: the job goes straight in."""
        maker = await _connected_user(engine, monkeypatch, email="save@test.dev")
        user_id, track_id, run_id = await _setup(maker, "save@test.dev", auto_save=True)
        await mcp_mod.get_scout_brief()
        assert await _capture(maker, user_id)
        out = await mcp_mod.report_job(
            str(run_id), JOB_URL, 8, "Runs M365 and Entra daily", "No Intune cert"
        )
        assert out["outcome"] == "saved"
        assert out["kept"] == 1 and out["done"] is False
        async with maker() as db:
            sj = await db.scalar(select(SavedJob).where(SavedJob.track_id == track_id))
            listing = await db.get(JobListing, sj.job_listing_id)
            assert listing.description == POSTING  # word for word
            assert listing.company == "Brambleworks, Inc."
            assert listing.apply_url == "https://www.linkedin.com/jobs/view/4012345678"
            folder = await db.get(Collection, sj.collection_id)
            assert folder.name == "IT Admin"  # named after the resume type
            finding = await db.scalar(select(ScoutFinding))
            assert finding.why_fit == "Runs M365 and Entra daily"
            assert finding.saved_job_id == sj.id
            # The job knows it came from Scout, and from which search.
            assert sj.origin == "scout"
            fits = await sj_svc.scout_fits(db, user_id)
            assert (fits[sj.id].fit_score, fits[sj.id].run_id) == (8, run_id)
            src = await job_source.job_source(db, user_id, sj.id)
            assert src.collection.name == "IT Admin" and src.email is None
            assert (src.scout.run_id, src.scout.fit_score) == (run_id, 8)
            assert (
                src.scout.source == "linkedin" and "IT Admin" in src.scout.search_name
            )
            assert src.scout.gaps == "No Intune cert"

    async def test_waits_for_the_copy_then_gives_up_without_saving(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="wait@test.dev")
        _, _, run_id = await _setup(maker, "wait@test.dev")
        await mcp_mod.get_scout_brief()
        first = await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "none")
        assert first["outcome"] == "waiting_for_copy"
        second = await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "none")
        assert second["outcome"] == "no_copy"
        async with maker() as db:
            assert (await db.scalars(select(SavedJob))).all() == []

    async def test_copy_arriving_late_still_counts(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="late@test.dev")
        user_id, _, run_id = await _setup(maker, "late@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "none")
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "none")
        assert out["outcome"] == "picked"

    async def test_search_page_link_is_rejected(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="link@test.dev")
        _, _, run_id = await _setup(maker, "link@test.dev")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.report_job(
            str(run_id), "https://www.linkedin.com/jobs/search/?keywords=it", 8, "", ""
        )
        assert out["outcome"] == "rejected_link"
        assert "jobs/view" in out["reason"]

    async def test_low_fit_is_remembered_not_saved(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="low@test.dev")
        user_id, _, run_id = await _setup(maker, "low@test.dev")
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 3, "", "Needs 10 years")
        assert out["outcome"] == "below_bar"
        rows = [{"company": "Brambleworks", "title": "IT Systems Administrator"}]
        assert (await mcp_mod.check_jobs(str(run_id), rows))["open"] == []

    async def test_pay_under_the_minimum_uses_the_listed_pay(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="pay@test.dev")
        user_id, _, run_id = await _setup(maker, "pay@test.dev", min_pay=70000)
        await mcp_mod.get_scout_brief()
        await _capture(
            maker, user_id, salary_min=24, salary_max=30, salary_period="hourly"
        )
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 9, "fits", "")
        assert out["outcome"] == "below_bar"
        assert "$62,400" in out["app_note"]

    async def test_next_run_never_saves_the_same_job_again(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="again@test.dev")
        user_id, _, run_id = await _setup(maker, "again@test.dev", auto_save=True)
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id)
        await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "")
        await mcp_mod.finish_scout_run(str(run_id), "done")

        _, _, run2 = await _setup_second_run(maker, "again@test.dev")
        await mcp_mod.get_scout_brief()
        rows = [{"company": "Brambleworks", "title": "IT Systems Administrator"}]
        assert (await mcp_mod.check_jobs(str(run2), rows))["open"] == []
        # Even if Claude opens it anyway, it isn't saved twice.
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run2), JOB_URL, 8, "fits", "")
        assert out["outcome"] == "duplicate"
        async with maker() as db:
            assert len((await db.scalars(select(SavedJob))).all()) == 1

    async def test_done_when_target_reached_and_finish_closes_the_run(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="done@test.dev")
        user_id, _, run_id = await _setup(maker, "done@test.dev", job_count=1)
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "")
        assert out["outcome"] == "picked"  # a good fit, kept for the user
        assert out["done"] is True and "finish_scout_run" in out["next"]
        fin = await mcp_mod.finish_scout_run(str(run_id), "1 strong match")
        assert fin["counts"]["picked"] == 1 and fin["counts"]["saved"] == 0
        assert "1 job is waiting" in fin["next"]
        async with maker() as db:
            assert (await db.scalars(select(SavedJob))).all() == []
        with pytest.raises(ValueError, match="done"):
            await mcp_mod.report_job(str(run_id), JOB_URL, 8, "", "")


async def _setup_second_run(maker, email):
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == email))
        (mission,) = await scout_runs.list_missions(db, user.id)
        run = await scout_runs.queue_run(db, mission.id, user.id)
        await db.commit()
        return user.id, mission.track_id, run.id


@pytest.mark.asyncio
async def test_captures_are_ignored_without_an_open_run(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="idle@test.dev")
    user_id, _, run_id = await _setup(maker, "idle@test.dev")
    async with maker() as db:
        await scout_runs.stop_run(db, run_id, user_id)
        await db.commit()
    assert await _capture(maker, user_id) is False


@pytest.mark.asyncio
async def test_copy_made_before_claude_starts_still_counts(engine, monkeypatch):
    """The user presses Start, then pastes the line: a page Claude opens while
    the run is still queued is copied under it, and report_job finds it."""
    maker = await _connected_user(engine, monkeypatch, email="early@test.dev")
    user_id, _, run_id = await _setup(maker, "early@test.dev")
    assert await _capture(maker, user_id) is True
    await mcp_mod.get_scout_brief()
    out = await mcp_mod.report_job(str(run_id), JOB_URL, 8, "fits", "")
    assert out["outcome"] == "picked"


@pytest.mark.asyncio
async def test_copy_filed_under_another_open_run_is_still_found(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="two@test.dev")
    user_id, _, first = await _setup(maker, "two@test.dev")
    _, _, second = await _setup_second_run(maker, "two@test.dev")
    await mcp_mod.get_scout_brief(str(second))  # both runs are open now
    await mcp_mod.get_scout_brief(str(first))
    assert await _capture(maker, user_id) is True
    out = await mcp_mod.report_job(str(second), JOB_URL, 8, "fits", "")
    assert out["outcome"] == "picked"


@pytest.mark.asyncio
async def test_only_the_brief_starts_a_queued_run(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="queue@test.dev")
    user_id, _, run_id = await _setup(maker, "queue@test.dev")
    with pytest.raises(ValueError, match="get_scout_brief"):
        await mcp_mod.finish_scout_run("")
    with pytest.raises(ValueError, match="get_scout_brief"):
        await mcp_mod.report_job(str(run_id), JOB_URL, 8, "", "")
    async with maker() as db:
        run = await db.get(ScoutRun, run_id)
        assert run.status == "queued"
