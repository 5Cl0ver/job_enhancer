"""Claude Scout keeps going (spec 021): a run whose searches came back thin
adds remote searches, a longer window and the titles it left out, until it
has enough good fits or has looked through its limit of jobs. Google is asked
in words it understands, and a town gets its state. Invented data."""

from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.application_profile import ApplicationProfile
from app.models.scout import ScoutMission, ScoutRun
from app.models.user import User
from app.services import scout_instructions as instr
from app.services import scout_runs
from tests.test_mcp_scout import _setup
from tests.test_mcp_server import _connected_user


def _q(url):
    return parse_qs(urlsplit(url).query)


def _criteria(**over):
    return {
        "source": "linkedin",
        "posted_within_days": 7,
        "location": "Springfield, IL",
        "remote": "any",
        "radius_miles": 25,
        "track": {"name": "IT Admin", "titles": ["IT Systems Administrator"]},
        **over,
    }


def _rows(n, count=3, title="IT Systems Administrator"):
    return [
        {
            "company": f"Brambleworks {n}-{i}",
            "title": title,
            "url": f"https://www.linkedin.com/jobs/view/{4200000000 + n * 100 + i}/",
        }
        for i in range(count)
    ]


async def _read_all(run_id, start, pages):
    """Send a page of new rows per search until check_jobs stops handing out
    a next page; returns the last answer and how many pages were sent."""
    out, n = None, start
    for n in range(start, start + pages):
        out = await mcp_mod.check_jobs(str(run_id), _rows(n), total_results=3)
        if "next_page_url" not in out:
            break
    return out, n


class TestGoogleWords:
    @pytest.mark.parametrize(
        ("days", "words"),
        [
            (1, "since yesterday"),
            (3, "in the last 3 days"),
            (7, "in the last week"),
            (14, "in the last month"),
        ],
    )
    def test_the_window_in_words(self, days, words):
        (url,) = scout_runs.start_urls(
            _criteria(source="google_jobs", posted_within_days=days)
        )
        assert _q(url)["q"] == [
            f"IT Systems Administrator jobs near Springfield, IL {words}"
        ]

    def test_the_place_with_its_state_and_never_within_miles(self):
        (url,) = scout_runs.start_urls(
            _criteria(source="google_jobs", location="Beaverton", where="Beaverton, OR")
        )
        q = _q(url)["q"][0]
        assert "near Beaverton, OR" in q and "within" not in q

    def test_thin_google_searches_are_widened(self):
        c = _criteria(source="google_jobs", posted_within_days=3)
        assert scout_runs._widen_to(c, 0, {"total": 4}) == 7
        assert (
            scout_runs._widen_to(_criteria(source="local_companies"), 0, {"total": 1})
            is None
        )


class TestRemoteLinks:
    def test_linkedin_remote_is_the_whole_country(self):
        url = scout_runs._link(_criteria(geo_id="104170880"), "IT Admin", remote=True)
        q = _q(url)
        assert q["location"] == ["United States"] and q["geoId"] == ["103644278"]
        assert q["f_WT"] == ["2"] and "distance" not in q

    def test_a_remote_only_search_no_longer_stays_in_town(self):
        (url,) = scout_runs.start_urls(_criteria(remote="remote_only"))
        q = _q(url)
        assert q["location"] == ["United States"] and q["f_WT"] == ["2"]

    def test_indeed_and_ziprecruiter_use_their_remote_filters(self):
        indeed = _q(
            scout_runs._link(_criteria(source="indeed"), "IT Admin", remote=True)
        )
        assert indeed["l"] == ["Remote"] and indeed["sc"] == ["0kf:attr(DSQF7);"]
        assert "radius" not in indeed
        zipr = _q(
            scout_runs._link(_criteria(source="ziprecruiter"), "IT Admin", remote=True)
        )
        assert zipr["refine_by_location_type"] == ["only_remote"]

    def test_local_searches_are_unchanged(self):
        q = _q(scout_runs._link(_criteria(source="indeed"), "IT Admin"))
        assert q["l"] == ["Springfield, IL"] and "sc" not in q


class TestKeepGoingSteps:
    def test_steps_in_order(self):
        c = _criteria(track={"name": "IT Admin", "titles": ["A", "B", "C"]})
        c["limits"] = {"links": 2}
        step = scout_runs._keep_going(c, {"rows": 10})
        assert step["step"] == "remote"
        assert [m["title"] for m in step["more"]] == ["A (remote)", "B (remote)"]
        c = {**c, "more": step["more"], "steps": step["steps"]}
        step = scout_runs._keep_going(c, {"rows": 20})
        assert step["step"] == "wider"
        assert {m["days"] for m in step["more"]} == {14}
        assert len(step["more"]) == 4  # local and remote, each title
        c = {**c, "more": c["more"] + step["more"], "steps": step["steps"]}
        step = scout_runs._keep_going(c, {"rows": 30})
        assert step["step"] == "titles"
        assert [m["title"] for m in step["more"]] == ["C", "C (remote)"]
        c = {**c, "more": c["more"] + step["more"], "steps": step["steps"]}
        assert scout_runs._keep_going(c, {"rows": 40}) is None

    def test_steps_that_dont_apply_are_passed_over(self):
        # No remote jobs wanted, already a long window, no titles left out.
        c = _criteria(remote="no_remote", posted_within_days=30)
        assert scout_runs._keep_going(c, {"rows": 5}) is None
        # No place: the searches already cover the whole country.
        step = scout_runs._keep_going(_criteria(location=None), {"rows": 5})
        assert step["step"] == "wider"

    def test_never_past_the_looks_limit_or_for_local_companies(self):
        assert scout_runs._keep_going(_criteria(), {"rows": 200}) is None
        c = _criteria(limits={"looks": 50})
        assert scout_runs._keep_going(c, {"rows": 50}) is None
        assert scout_runs._keep_going(_criteria(source="local_companies"), {}) is None

    def test_added_searches_follow_the_first_ones(self):
        c = _criteria()
        step = scout_runs._keep_going(c, {"rows": 3})
        c = {**c, "more": step["more"], "steps": step["steps"]}
        links = scout_runs.search_links(c)
        assert [link["title"] for link in links] == [
            "IT Systems Administrator",
            "IT Systems Administrator (remote)",
        ]
        assert scout_runs.base_count(c) == 1
        assert scout_runs._days_at(c, 1) == 7

    def test_the_search_its_on_wins_when_words_are_shared(self):
        c = _criteria()
        step = scout_runs._keep_going(c, {"rows": 3})
        c = {**c, "more": step["more"], "steps": step["steps"]}
        remote = scout_runs.search_links(c)[1]["url"]
        assert scout_runs._link_of(c, remote, 1) == 1
        assert scout_runs._link_of(c, remote) == 0


@pytest.mark.asyncio
class TestARunKeepsGoing:
    async def test_thin_searches_keep_going_then_finish(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="k1@test.dev")
        _, _, run_id = await _setup(maker, "k1@test.dev", job_count=10)
        brief = await mcp_mod.get_scout_brief()
        assert len(brief["start_urls"]) == 2
        out = await mcp_mod.check_jobs(str(run_id), _rows(0), total_results=3)
        assert out["next_page_url"] == brief["start_urls"][1]
        out = await mcp_mod.check_jobs(str(run_id), _rows(1), total_results=3)
        # Both searches read, still short: remote jobs anywhere next.
        assert "keep going" in out["next"]
        assert "remote jobs anywhere in the country" in out["next"]
        assert "IT Systems Administrator (remote) (3 of 4)" in out["next"]
        assert _q(out["next_page_url"])["f_WT"] == ["2"]
        out = await mcp_mod.check_jobs(
            str(run_id), _rows(2), total_results=3, page_url=out["next_page_url"]
        )
        assert "Jira Administrator (remote) (4 of 4)" in out["next"]
        out = await mcp_mod.check_jobs(str(run_id), _rows(3), total_results=3)
        # Then the past 14 days, local and remote.
        assert "the past 14 days" in out["next"]
        assert _q(out["next_page_url"])["f_TPR"] == [f"r{14 * 86400}"]
        out, _ = await _read_all(run_id, 4, 6)
        # Nothing left to add (both titles were searched): done.
        assert "next_page_url" not in out and "last search" in out["next"]
        fin = await mcp_mod.finish_scout_run(str(run_id), "")
        assert (
            "Looked through 24 jobs, and kept going with remote jobs anywhere in "
            "the country and the past 14 days."
        ) in fin["next"]

    async def test_a_run_that_has_enough_never_keeps_going(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="k2@test.dev")
        _, _, run_id = await _setup(maker, "k2@test.dev", job_count=1)
        await mcp_mod.get_scout_brief()
        monkeypatch.setattr(scout_runs, "_progress", _fake_progress(done=True))
        await mcp_mod.check_jobs(str(run_id), _rows(0), total_results=3)
        await mcp_mod.check_jobs(str(run_id), _rows(1), total_results=3)
        async with maker() as db:
            assert "more" not in (await db.get(ScoutRun, run_id)).criteria

    async def test_the_looks_limit_stops_the_added_searches(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="k3@test.dev")
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "k3@test.dev"))
            await instr.save(db, user.id, "limits", values={"looks": 50})
            await db.commit()
        _, _, run_id = await _setup(maker, "k3@test.dev", job_count=10)
        await mcp_mod.get_scout_brief()
        big = [
            {"company": f"Vellacor {i}", "title": "IT Systems Administrator"}
            for i in range(25)
        ]
        await mcp_mod.check_jobs(str(run_id), big[:20], total_results=20)
        out = await mcp_mod.check_jobs(
            str(run_id),
            [{**r, "company": f"Quillfeather {i}"} for i, r in enumerate(big[:20])],
            total_results=20,
        )
        assert "keep going" in out["next"]  # 40 looked at: under the limit
        out = await mcp_mod.check_jobs(
            str(run_id),
            [{**r, "company": f"Larkspire {i}"} for i, r in enumerate(big[:20])],
            total_results=20,
        )
        # 60 looked at: the rest of the added searches are left.
        assert "next_page_url" not in out
        assert "looked through 60 jobs, its limit" in out["next"]

    async def test_a_town_gets_its_state_from_the_profile(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="k4@test.dev")
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "k4@test.dev"))
            db.add(ApplicationProfile(user_id=user.id, city="beaverton", state="OR"))
            await db.commit()
            assert await scout_runs._with_state(db, user.id, "Beaverton") == (
                "Beaverton, OR"
            )
            # Another town, or one that already names more, as typed.
            assert await scout_runs._with_state(db, user.id, "Tigard") == "Tigard"
            assert (
                await scout_runs._with_state(db, user.id, "Beaverton, Oregon")
                == "Beaverton, Oregon"
            )
            assert await scout_runs._with_state(db, user.id, None) is None
        user_id, _, run_id = await _setup(maker, "k4@test.dev")
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            mission = await db.get(ScoutMission, run.mission_id)
            mission.location = "Beaverton"
            run.status = "done"
            await db.commit()
            again = await scout_runs.queue_run(db, mission.id, user_id)
            assert again.criteria["location"] == "Beaverton"
            assert again.criteria["where"] == "Beaverton, OR"
            q = _q(scout_runs.start_urls(again.criteria)[0])
            assert q["location"] == ["Beaverton, OR"]


def _fake_progress(*, done):
    async def progress(db, run):
        return {"kept": 0, "target": run.criteria["job_count"], "done": done}

    return progress


class TestRules:
    def test_one_job_never_ends_a_run(self):
        assert "One job is never a reason to stop" in instr.RULES
        assert "or won't load at" in instr.RULES
        steps = instr.ORIGINALS["playbook"]
        assert "check_jobs adds more" in steps and "keep going" in steps


def _one_title(maker, email, **kw):
    """A run whose resume type has one title, so every added search shares
    its words."""
    return _setup(maker, email, job_count=10, **kw)


@pytest.mark.asyncio
class TestReviewFixes:
    async def test_the_longer_window_starts_past_the_pages_read(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="f1@test.dev")
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "f1@test.dev"))
            await instr.save(db, user.id, "limits", values={"links": 1})
            await db.commit()
        _, _, run_id = await _one_title(maker, "f1@test.dev")
        await mcp_mod.get_scout_brief()
        # The first search: 40 results, read over 2 pages.
        await mcp_mod.check_jobs(str(run_id), _rows(0, 25), total_results=40)
        out = await mcp_mod.check_jobs(str(run_id), _rows(1, 15))
        assert "(remote)" in out["next"]  # then remote jobs
        out = await mcp_mod.check_jobs(str(run_id), _rows(2), total_results=3)
        assert "the past 14 days" in out["next"]
        url = out["next_page_url"]
        q = _q(url)
        assert q["f_TPR"] == [f"r{14 * 86400}"]
        # 40 results read: the newest 25 (one whole page) are skipped.
        assert q["start"] == ["25"]
        # Its next page goes on from there.
        out = await mcp_mod.check_jobs(str(run_id), _rows(3, 25), total_results=60)
        assert _q(out["next_page_url"])["start"] == ["50"]

    async def test_a_resend_on_searches_sharing_words_skips_nothing(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="f2@test.dev")
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "f2@test.dev"))
            await instr.save(db, user.id, "limits", values={"links": 1})
            await db.commit()
        _, _, run_id = await _one_title(maker, "f2@test.dev")
        brief = await mcp_mod.get_scout_brief()
        page = brief["start_urls"][0]
        first = await mcp_mod.check_jobs(
            str(run_id), _rows(0), total_results=3, page_url=page
        )
        assert "(remote)" in first["next"]
        # The same call again (a retry): the same answer, nothing skipped.
        again = await mcp_mod.check_jobs(
            str(run_id), _rows(0), total_results=3, page_url=page
        )
        assert again["next"] == first["next"]
        assert again["next_page_url"] == first["next_page_url"]
        async with maker() as db:
            stats = (await db.get(ScoutRun, run_id)).stats
            assert stats["_link"] == 1 and "1" not in stats["_links"]

    async def test_a_place_fix_on_a_remote_search_is_ignored(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="f3@test.dev")
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "f3@test.dev"))
            await instr.save(db, user.id, "limits", values={"links": 1})
            await db.commit()
        _, _, run_id = await _one_title(maker, "f3@test.dev")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.check_jobs(str(run_id), _rows(0), total_results=3)
        remote = out["next_page_url"]
        await mcp_mod.check_jobs(
            str(run_id),
            _rows(1),
            total_results=3,
            page_url=remote,
            place_fixed=True,
        )
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            mission = await db.get(ScoutMission, run.mission_id)
            assert mission.linkedin_geo_id is None
            assert run.criteria.get("geo_id") is None


class TestTipsAndLines:
    def _run(self, **stats):
        c = _criteria()
        c["job_count"] = 5
        return ScoutRun(criteria=c, stats=stats, status="done")

    def test_a_run_at_its_limit_says_so(self):
        tip = scout_runs.run_tip(self._run(rows=200), {})
        assert "looked through 200 jobs, its limit" in tip
        assert "Instructions" in tip

    def test_a_run_that_searched_14_days_never_suggests_14(self):
        c = {**_criteria(), "job_count": 5, "steps": ["remote", "wider"]}
        run = ScoutRun(
            criteria=c,
            stats={"rows": 40, "pages": 1, "_links": {"0": {"total": 10}}},
            status="done",
        )
        tip = scout_runs.run_tip(run, {})
        assert "14 days" not in (tip or "")

    def test_the_per_search_line_names_at_most_eight(self):
        c = _criteria(
            track={"name": "IT Admin", "titles": [f"Title {i}" for i in range(10)]},
            limits={"links": 10},
        )
        stats = {"_links": {str(i): {"total": i} for i in range(10)}}
        line = scout_runs.links_line(c, stats)
        assert "Title 7 7" in line and "Title 8" not in line
        assert line.endswith("· and 2 more.")
