"""Scout results you can see, sort and act on, at your level (spec 012).

Results grouped against each run's bar; the Last run numbers; levels on
LinkedIn links and the app's own cap; recommended settings; Claude's short
facts; Too far; thin searches widening; suggested titles; the openings a
company's careers page listed. Invented companies throughout.
"""

from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.scout import ScoutCompany, ScoutFinding, ScoutRun
from app.schemas.scout import CaptureIn, MissionCreate, TrackCreate
from app.services import scout_levels as lv
from app.services import scout_results, scout_runs, scout_tracks
from app.services.scout_runs import clean_facts
from tests.api.test_scout_tracks import _other_user
from tests.test_mcp_scout import POSTING
from tests.test_mcp_server import _connected_user


def _q(url):
    return parse_qs(urlsplit(url).query)


def _url(n: int) -> str:
    return f"https://www.linkedin.com/jobs/view/4099{n:06d}/"


async def _run(db, user, *, levels=("entry", "mid"), years=None, **mission):
    track = await scout_tracks.create_track(
        db,
        user.id,
        TrackCreate(
            name="IT Admin",
            target_titles=["Systems Administrator"],
            key_skills=["Microsoft 365"],
            levels=list(levels),
            years=years,
        ),
    )
    m = await scout_runs.create_mission(
        db,
        user.id,
        MissionCreate(
            source=mission.pop("source", "linkedin"),
            track_id=track.id,
            location=mission.pop("location", "Springfield, IL"),
            **mission,
        ),
    )
    run = await scout_runs.queue_run(db, m.id, user.id)
    await scout_runs.brief(db, user.id, str(run.id))
    await db.commit()
    return run


async def _report(db, user, run, n, fit, *, copy=True, title=None, **facts):
    title = title or f"Systems Administrator {n}"
    if copy:
        assert await scout_runs.record_capture(
            db,
            user.id,
            CaptureIn(
                url=_url(n),
                title=title,
                company=f"Vellacor {n}",
                location="Springfield, IL",
                description=POSTING,
                via="linkedin",
            ),
        )
    out = await scout_runs.report_job(
        db,
        user.id,
        str(run.id),
        _url(n),
        fit,
        "fits",
        "gaps",
        facts={"title": title, "company": f"Vellacor {n}", **facts},
    )
    await db.commit()
    return out


# --------------------------------------------------------------------------- #
# Levels and the cap (research R3, R4)
# --------------------------------------------------------------------------- #
class TestLevels:
    def test_linkedin_codes(self):
        assert lv.linkedin_f_e(["entry", "mid"]) == "2,3,4"
        assert lv.linkedin_f_e(["entry"]) == "2"
        assert lv.linkedin_f_e(["senior"]) == "4,5"
        assert lv.linkedin_f_e([]) == "2,3,4"  # the default

    def test_labels(self):
        assert lv.levels_label(["mid", "entry"]) == "Entry–Mid"
        assert lv.levels_label(["entry", "senior"]) == "Entry + Senior"
        assert lv.levels_label(["senior"]) == "Senior"

    @pytest.mark.parametrize(
        ("fit", "level", "years", "asked", "want"),
        [
            (9, "mid", 5, 4, 9),  # at the user's level: untouched
            (9, "senior", None, None, 5),  # one step up: under the bar
            (9, "lead", None, None, 3),  # two steps: a long shot
            (9, "mid", 5, 10, 3),  # asks for 5 more years than the user has
            (9, "mid", 5, 8, 5),  # 3 more
            (4, "senior", None, None, 4),  # already under the cap
        ],
    )
    def test_cap(self, fit, level, years, asked, want):
        got, note = lv.cap(fit, 6, ["entry", "mid"], years, level, asked)
        assert got == want
        assert (note is not None) == (got != fit)

    def test_senior_chosen_lets_senior_through(self):
        assert lv.cap(9, 6, ["mid", "senior"], None, "senior", None) == (9, None)

    def test_senior_titles(self):
        assert lv.senior_title("Sr. Systems Administrator")
        assert lv.senior_title("IT Manager")
        assert not lv.senior_title("Help Desk Technician II")


class TestFacts:
    def test_cut_and_checked(self):
        out = clean_facts(
            {
                "title": "  IT   Admin ",
                "company": "x" * 500,
                "level": "Senior",
                "years_asked": "7",
                "posted": "2 days ago",
                "in_area": "false",
                "description": "never kept",
            }
        )
        assert out["title"] == "IT Admin" and len(out["company"]) == 120
        assert out["level"] == "senior" and out["years_asked"] == 7
        assert out["in_area"] is False and "description" not in out

    def test_bad_values_dropped(self):
        assert clean_facts({"level": "boss", "years_asked": 99}) == {}
        assert clean_facts(None) == {}


# --------------------------------------------------------------------------- #
# What Claude is given and what it reports
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestBriefAndReports:
    async def test_links_carry_levels_and_the_brief_says_them(
        self, db_session, test_user
    ):
        run = await _run(db_session, test_user, years=5)
        brief = await scout_runs.brief(db_session, test_user.id, str(run.id))
        assert _q(brief["start_urls"][0])["f_E"] == ["2,3,4"]
        assert "2%2C3%2C4" in brief["start_urls"][0]
        assert "Entry–Mid" in brief["level_rule"]
        assert "5 years" in brief["level_rule"]
        assert brief["track"]["levels"] == ["entry", "mid"]
        assert "Springfield, IL" in brief["area"]["rule"]
        assert brief["area"]["radius_miles"] == 25

    async def test_a_senior_job_is_capped_and_says_why(self, db_session, test_user):
        run = await _run(db_session, test_user)
        out = await _report(db_session, test_user, run, 1, 9, level="senior")
        assert out["outcome"] == "below_bar" and "Lowered to 5" in out["note"]
        f = await db_session.scalar(select(ScoutFinding))
        assert (f.fit_score, f.claude_fit, f.level) == (5, 9, "senior")
        assert "senior role" in f.app_note

    async def test_too_far_is_not_counted_and_remembered(self, db_session, test_user):
        run = await _run(db_session, test_user)
        out = await _report(db_session, test_user, run, 2, 8, in_area=False)
        assert out["outcome"] == "too_far" and out["kept"] == 0
        again = await _report(db_session, test_user, run, 2, 8, in_area=False)
        assert again["note"] == "Already reported in this run."

    async def test_without_a_copy_the_facts_still_name_the_job(
        self, db_session, test_user
    ):
        run = await _run(db_session, test_user)
        for _ in range(2):
            out = await _report(db_session, test_user, run, 3, 7, copy=False)
            assert out["outcome"] == "waiting_for_copy"
        out = await _report(db_session, test_user, run, 3, 7, copy=False)
        assert out["outcome"] == "no_copy"
        f = await db_session.scalar(select(ScoutFinding))
        assert (f.title, f.company, f.facts_from) == (
            "Systems Administrator 3",
            "Vellacor 3",
            "claude",
        )

    async def test_the_page_copy_wins_over_claude(self, db_session, test_user):
        run = await _run(db_session, test_user)
        await _report(db_session, test_user, run, 4, 7, copy=False, title="As read")
        f = await db_session.scalar(select(ScoutFinding))
        assert (f.title, f.facts_from) == ("As read", "claude")
        await scout_runs.record_capture(
            db_session,
            test_user.id,
            CaptureIn(
                url=_url(4),
                title="On the page",
                company="Vellacor 4",
                location="Springfield, IL",
                description=POSTING,
                via="linkedin",
            ),
        )
        await _report(db_session, test_user, run, 4, 7, copy=False, title="As read")
        await db_session.refresh(f)
        assert (f.title, f.facts_from) == ("On the page", "copy")
        assert f.location == "Springfield, IL" and f.outcome == "picked"


@pytest.mark.asyncio
class TestWidening:
    async def test_a_thin_search_is_read_again_over_a_longer_window(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="wd@test.dev")
        async with maker() as db:
            from app.models.user import User

            user = await db.scalar(select(User).where(User.email == "wd@test.dev"))
            run = await _run(db, user, posted_within_days=1)
        rows = [
            {"company": "Vellacor", "title": "Systems Administrator", "url": _url(9)}
        ]
        out = await mcp_mod.check_jobs(str(run.id), rows, total_results=12)
        q = _q(out["next_page_url"])
        assert q["keywords"] == ["Systems Administrator"]
        assert q["f_TPR"] == [f"r{3 * 86400}"]
        assert "widened to the past 3 days" in out["next"]
        # Only once: the widened search, thin too, moves on.
        rows2 = [{"company": "Quillstone", "title": "IT Admin", "url": _url(10)}]
        out2 = await mcp_mod.check_jobs(str(run.id), rows2, total_results=14)
        assert "widened" not in out2["next"]
        async with maker() as db:
            r = await db.get(ScoutRun, run.id)
            (out_run,) = await scout_runs.runs_out(db, [r])
        assert [w.model_dump() for w in out_run.widened] == [
            {"title": "Systems Administrator", "days": 3}
        ]
        assert out_run.links[0].total == 14

    async def test_a_full_search_is_not_widened(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="wd2@test.dev")
        async with maker() as db:
            from app.models.user import User

            user = await db.scalar(select(User).where(User.email == "wd2@test.dev"))
            run = await _run(db, user, posted_within_days=1)
        rows = [
            {"company": "Vellacor", "title": "Systems Administrator", "url": _url(9)}
        ]
        out = await mcp_mod.check_jobs(str(run.id), rows, total_results=60)
        assert _q(out["next_page_url"])["f_TPR"] == ["r86400"]


@pytest.mark.asyncio
class TestSuggestedTitles:
    async def test_claude_adds_titles_at_the_users_level(self, db_session, test_user):
        run = await _run(db_session, test_user)
        brief = await scout_runs.brief(db_session, test_user.id, str(run.id))
        assert "suggest_titles" not in brief  # no resume to suggest from
        out = await scout_runs.set_search_titles(
            db_session,
            test_user.id,
            str(run.id),
            [
                "IT Support Specialist",
                "Senior Systems Engineer",
                "Systems Administrator",
                "Help Desk Analyst",
                "Desktop Support Technician",
                "Network Technician",
                "Field Technician",
            ],
        )
        assert out["titles"] == [
            "IT Support Specialist",
            "Help Desk Analyst",
            "Desktop Support Technician",
            "Network Technician",
        ]
        why = {d["title"]: d["why"] for d in out["dropped"]}
        assert why["Senior Systems Engineer"] == "above the user's levels"
        assert why["Systems Administrator"] == "already searched"
        assert len(out["start_urls"]) == 5
        await db_session.commit()
        (run_out,) = await scout_runs.runs_out(db_session, [run])
        assert run_out.suggested_titles == out["titles"]
        # Once set, it can't be set again.
        with pytest.raises(ValueError, match="resume type's titles"):
            await scout_runs.set_search_titles(
                db_session, test_user.id, str(run.id), ["Field Technician"]
            )

    async def test_a_type_with_related_titles_gets_none(self, db_session, test_user):
        run = await _run(db_session, test_user)
        run.criteria = {
            **run.criteria,
            "track": {**run.criteria["track"], "related": ["Help Desk Analyst"]},
        }
        assert scout_runs.suggest_count(run.criteria, run.stats) == 0


@pytest.mark.asyncio
class TestCompanyOpenings:
    async def test_openings_are_kept_and_listed(self, engine, monkeypatch):
        from tests.test_scout_companies import _co, _setup

        maker = await _connected_user(engine, monkeypatch, email="op@test.dev")
        user_id, _, run_id = await _setup(maker, "op@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_companies(
            str(run_id), [_co("Brambleworks", "brambleworks.example")]
        )
        openings = [
            {"title": "IT Technician", "url": "https://brambleworks.example/j/1"},
            {
                "title": "Payroll Clerk",
                "url": "https://brambleworks.example/j/2",
                "fit": 2,
            },
            {"title": "no link", "url": "javascript:alert(1)"},
            *[
                {"title": f"Role {i}", "url": f"https://brambleworks.example/r/{i}"}
                for i in range(30)
            ],
        ]
        await mcp_mod.company_checked(
            str(run_id), "brambleworks.example", "openings", openings=openings
        )
        async with maker() as db:
            company = await db.scalar(
                select(ScoutCompany).where(ScoutCompany.user_id == user_id)
            )
            assert len(company.last_openings) == 20
            assert company.last_openings[0] == {
                "title": "IT Technician",
                "url": "https://brambleworks.example/j/1",
                "fit": None,
            }
            assert company.last_openings[1]["fit"] == 2


# --------------------------------------------------------------------------- #
# Results and the Last run (the page)
# --------------------------------------------------------------------------- #
async def _mixed(db, user):
    """A run with a best, a possible, a long shot, one not copied, and one too
    far away."""
    run = await _run(db, user)
    await _report(db, user, run, 1, 8)  # best
    await _report(db, user, run, 2, 5)  # possible
    await _report(db, user, run, 3, 2)  # long shot
    for _ in range(3):
        await _report(db, user, run, 4, 7, copy=False)  # best, not copied
    await _report(db, user, run, 5, 9, in_area=False)  # hidden
    return run


@pytest.mark.asyncio
class TestResults:
    async def test_groups_and_counts(self, client: AsyncClient, db_session, test_user):
        run = await _mixed(db_session, test_user)
        body = (await client.get("/v1/scout/findings")).json()
        assert [i["band"] for i in body["items"]] == [
            "best",
            "best",
            "possible",
            "long_shot",
        ]
        assert body["counts"] == {
            "best": 2,
            "possible": 1,
            "long_shot": 1,
            "new": 4,
            "saved": 0,
            "passed": 0,
            "hidden": 1,
        }
        not_copied = next(i for i in body["items"] if i["outcome"] == "no_copy")
        assert not_copied["title"] == "Systems Administrator 4"
        assert not_copied["facts_from"] == "claude" and not not_copied["can_save"]
        assert body["items"][0]["run_name"] and body["items"][0]["min_fit"] == 6

        hidden = (await client.get("/v1/scout/findings?status=hidden")).json()
        assert [i["outcome"] for i in hidden["items"]] == ["too_far"]
        last = (await client.get("/v1/scout/findings?run=last")).json()
        assert last["counts"]["new"] == 4
        one = (await client.get(f"/v1/scout/findings?run={run.id}&limit=1")).json()
        assert len(one["items"]) == 1 and one["next"] == 1

    async def test_pass_and_restore(self, client: AsyncClient, db_session, test_user):
        await _mixed(db_session, test_user)
        body = (await client.get("/v1/scout/findings")).json()
        best = body["items"][0]
        r = await client.post(f"/v1/scout/findings/{best['id']}/pass")
        assert r.status_code == 200 and r.json()["status"] == "passed"
        body = (await client.get("/v1/scout/findings")).json()
        assert body["counts"]["new"] == 3 and body["counts"]["passed"] == 1
        assert (
            await client.post(f"/v1/scout/findings/{best['id']}/pass")
        ).status_code == 409
        back = await client.post(f"/v1/scout/findings/{best['id']}/restore")
        assert back.json()["status"] == "new" and back.json()["outcome"] == "picked"

    async def test_save_a_pick_and_refuse_without_a_copy(
        self, client: AsyncClient, db_session, test_user
    ):
        await _mixed(db_session, test_user)
        items = (await client.get("/v1/scout/findings")).json()["items"]
        pick = next(i for i in items if i["outcome"] == "picked")
        r = await client.post(f"/v1/scout/findings/{pick['id']}/save", json={})
        assert r.status_code == 200 and r.json()["saved_job_id"]
        saved = (await client.get("/v1/scout/findings?status=saved")).json()
        assert [i["id"] for i in saved["items"]] == [pick["id"]]
        no_copy = next(i for i in items if i["outcome"] == "no_copy")
        r = await client.post(f"/v1/scout/findings/{no_copy['id']}/save", json={})
        assert r.status_code == 409

    async def test_only_your_own(self, client: AsyncClient, db_session, test_user):
        other = await _other_user(db_session)
        await _mixed(db_session, other)
        assert (await client.get("/v1/scout/findings")).json()["items"] == []
        theirs = await db_session.scalar(select(ScoutFinding))
        r = await client.post(f"/v1/scout/findings/{theirs.id}/pass")
        assert r.status_code == 404

    async def test_bad_filters(self, client: AsyncClient):
        assert (await client.get("/v1/scout/findings?status=x")).status_code == 422
        assert (await client.get("/v1/scout/findings?run=nope")).status_code == 422
        assert (await client.get("/v1/scout/findings?run=all")).status_code == 200
        assert (await client.get("/v1/scout/findings?limit=501")).status_code == 422

    async def test_the_last_run_numbers(
        self, client: AsyncClient, db_session, test_user
    ):
        run = await _mixed(db_session, test_user)
        await scout_runs.finish_run(db_session, test_user.id, str(run.id), "done")
        await db_session.commit()
        body = (await client.get(f"/v1/scout/runs/{run.id}")).json()
        assert body["bands"] == {"best": 2, "possible": 1, "long_shot": 1}
        assert body["hidden"] == {"repeats": 0, "too_far": 1}
        assert body["not_copied"] == 1
        looking = body["looking_for"]
        assert looking["levels"] == ["entry", "mid"]
        assert looking["location"] == "Springfield, IL"
        assert looking["radius_miles"] == 25 and looking["min_fit"] == 6


class TestBandsAndStatuses:
    def test_band(self):
        assert [scout_results.band(f, 6) for f in (6, 4, 3)] == [
            "best",
            "possible",
            "long_shot",
        ]

    def test_status(self):
        import uuid

        assert scout_results.status_of("duplicate", uuid.uuid4()) == "saved"
        assert scout_results.status_of("duplicate", None) == "hidden"
        assert scout_results.status_of("no_copy", None) == "new"
        assert scout_results.status_of("skipped", None) == "passed"


# --------------------------------------------------------------------------- #
# Recommended settings and levels on resume types
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestSettings:
    async def test_recommended(self, client: AsyncClient):
        body = (await client.get("/v1/scout/recommended")).json()
        assert body == {
            "mission": {
                "job_count": 10,
                "posted_within_days": 7,
                "min_fit": 6,
                "radius_miles": 25,
            },
            "track": {"levels": ["entry", "mid"], "skip": {"degree_only": False}},
        }

    async def test_levels_on_resume_types(self, client: AsyncClient):
        t = (await client.post("/v1/scout/tracks", json={"name": "IT Admin"})).json()
        assert t["levels"] == ["entry", "mid"] and t["years"] is None
        r = await client.patch(
            f"/v1/scout/tracks/{t['id']}",
            json={"levels": ["senior", "mid"], "years": 5},
        )
        assert r.json()["levels"] == ["mid", "senior"] and r.json()["years"] == 5
        bad = await client.patch(f"/v1/scout/tracks/{t['id']}", json={"levels": []})
        assert bad.status_code == 422
        bad = await client.patch(
            f"/v1/scout/tracks/{t['id']}", json={"levels": ["boss"]}
        )
        assert bad.status_code == 422


# --------------------------------------------------------------------------- #
# Found in review
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestReviewFixes:
    async def test_a_widened_search_showing_the_same_rows_moves_on(
        self, db_session, test_user
    ):
        track = await scout_tracks.create_track(
            db_session,
            test_user.id,
            TrackCreate(name="IT Admin", target_titles=["Sys Admin", "IT Admin"]),
        )
        m = await scout_runs.create_mission(
            db_session,
            test_user.id,
            MissionCreate(
                source="linkedin",
                track_id=track.id,
                location="Springfield, IL",
                posted_within_days=1,
            ),
        )
        run = await scout_runs.queue_run(db_session, m.id, test_user.id)
        await scout_runs.brief(db_session, test_user.id, str(run.id))
        rows = [{"company": "Vellacor", "title": "Sys Admin", "url": _url(1)}]
        first = await scout_runs.check_jobs(
            db_session, test_user.id, str(run.id), rows, total_results=4
        )
        assert "widened" in first["next"]
        again = await scout_runs.check_jobs(
            db_session, test_user.id, str(run.id), rows, total_results=4
        )
        # Nothing new in the wider window: on to the next search, not a loop.
        assert "widened" not in again["next"]
        assert _q(again["next_page_url"])["keywords"] == ["IT Admin"]

    async def test_too_far_is_per_search_not_per_resume_type(
        self, db_session, test_user
    ):
        run = await _run(db_session, test_user)
        await _report(db_session, test_user, run, 7, 8, in_area=False)
        await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        row = [
            {
                "company": "Vellacor 7",
                "title": "Systems Administrator 7",
                "url": _url(7),
            }
        ]
        # The same search again: still hidden.
        (mission_id,) = [run.mission_id]
        again = await scout_runs.queue_run(db_session, mission_id, test_user.id)
        await scout_runs.brief(db_session, test_user.id, str(again.id))
        out = await scout_runs.check_jobs(db_session, test_user.id, str(again.id), row)
        assert out["open"] == []
        await scout_runs.finish_run(db_session, test_user.id, str(again.id), "")
        # Another search (another place) for the same resume type: looked at.
        other = await scout_runs.create_mission(
            db_session,
            test_user.id,
            MissionCreate(
                source="linkedin", track_id=run.track_id, location="Peoria, IL"
            ),
        )
        third = await scout_runs.queue_run(db_session, other.id, test_user.id)
        await scout_runs.brief(db_session, test_user.id, str(third.id))
        out = await scout_runs.check_jobs(db_session, test_user.id, str(third.id), row)
        assert out["open"] == [0]

    async def test_results_keep_the_saved_finding_over_a_later_repeat(
        self, client: AsyncClient, db_session, test_user
    ):
        import uuid

        run = await _run(db_session, test_user)
        await _report(db_session, test_user, run, 8, 8)
        (f,) = (await db_session.scalars(select(ScoutFinding))).all()
        f.outcome, f.saved_job_id = "saved", None
        db_session.add(
            ScoutFinding(
                id=uuid.uuid4(),
                user_id=test_user.id,
                run_id=run.id,
                source="linkedin",
                url=f.url,
                url_key=f.url_key,
                fit_score=8,
                outcome="duplicate",
            )
        )
        await db_session.commit()
        body = (await client.get("/v1/scout/findings?run=all&status=saved")).json()
        assert [i["id"] for i in body["items"]] == [str(f.id)]
        assert body["counts"]["hidden"] == 0

    def test_a_workday_job_list_is_not_a_posting(self):
        from app.services.scout_dedupe import posting_problem

        site = "https://vellacor.wd1.myworkdayjobs.com"
        assert "job list" in posting_problem(f"{site}/en-US/External")
        assert (
            posting_problem(f"{site}/en-US/External/job/Springfield-IL/X_R-1") is None
        )
