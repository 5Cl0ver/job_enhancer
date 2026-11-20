"""Claude Scout's "Anything I'd be good at" search (spec 009, US2 and US3).

Claude picks the titles from the resume; the app applies the user's overrides,
builds the links with the user's own filters, remembers how each title did and
rests titles that keep finding nothing. Invented people and companies.
"""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.resume_track import ResumeTrack
from app.models.saved_job import SavedJob
from app.models.scout import ScoutFinding, ScoutRun, ScoutTitle
from app.models.user import User
from app.schemas.scout import MissionCreate, MissionUpdate, Overrides, TrackCreate
from app.services import scout_runs, scout_titles, scout_tracks
from app.services.scout_titles import best_title
from tests.test_mcp_scout import POSTING
from tests.test_mcp_server import _connected_user
from tests.test_scout_resume_grounding import _resume

TITLES = [
    "IT Systems Administrator",
    "Microsoft 365 Administrator",
    "Identity and Access Analyst",
]


def _job(n: int) -> str:
    return f"https://www.linkedin.com/jobs/view/{4300000000 + n}/"


async def _broad(maker, email, *, resume=True, source="linkedin", job_count=3, **kw):
    """A user with an "IT Admin" resume type and a broad search, queued."""
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == email))
        await scout_tracks.create_track(
            db,
            user.id,
            TrackCreate(name="IT Admin", target_titles=["IT Systems Administrator"]),
        )
        mission = await scout_runs.create_mission(
            db,
            user.id,
            MissionCreate(
                source=source,
                broad=True,
                job_count=job_count,
                location="Springfield, IL",
                radius_miles=25,
                posted_within_days=3,
                **kw,
            ),
        )
        await db.commit()
        user_id, mission_id = user.id, mission.id
    if resume:
        await _resume(maker, user_id)
    run_id = await _queue(maker, user_id, mission_id)
    return user_id, mission_id, run_id


async def _queue(maker, user_id, mission_id):
    async with maker() as db:
        run = await scout_runs.queue_run(db, mission_id, user_id)
        await db.commit()
        return run.id


async def _copy(maker, user_id, n, title, company="Brambleworks"):
    from app.schemas.scout import CaptureIn

    async with maker() as db:
        await scout_runs.record_capture(
            db,
            user_id,
            CaptureIn(
                url=_job(n),
                title=title,
                company=company,
                location="Springfield, IL",
                description=POSTING,
                via="linkedin",
            ),
        )
        await db.commit()


async def _report_fit(maker, user_id, run_id, n, title, score=8, resume_type=""):
    await mcp_mod.check_jobs(
        str(run_id), [{"company": f"Vellacor {n}", "title": title, "url": _job(n)}]
    )
    await _copy(maker, user_id, n, title, company=f"Vellacor {n}")
    return await mcp_mod.report_job(
        str(run_id), _job(n), score, "Ran Microsoft 365", "", resume_type
    )


@pytest.mark.asyncio
class TestBroadTrack:
    async def test_hidden_from_resume_types_and_made_once(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="b1@test.dev")
        user_id, mission_id, _ = await _broad(maker, "b1@test.dev")
        async with maker() as db:
            listed = await scout_tracks.list_tracks(db, user_id)
            assert [t.name for t in listed] == ["IT Admin"]
            again = await scout_runs.create_mission(
                db, user_id, MissionCreate(source="indeed", broad=True)
            )
            broad = (
                await db.scalars(select(ResumeTrack).where(ResumeTrack.kind == "broad"))
            ).all()
            assert len(broad) == 1 and again.track_id == broad[0].id
            # The page can't change or delete it.
            with pytest.raises(HTTPException) as e:
                await scout_tracks.get_track(db, broad[0].id, user_id)
            assert e.value.status_code == 404

    async def test_its_name_is_reserved_and_it_isnt_counted(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="b2@test.dev")
        user_id, _, _ = await _broad(maker, "b2@test.dev")
        async with maker() as db:
            with pytest.raises(HTTPException) as e:
                await scout_tracks.create_track(
                    db, user_id, TrackCreate(name="anything i'd be good at")
                )
            assert e.value.status_code == 422
            for i in range(7):  # 1 + 7 = the limit of 8 the user can make
                await scout_tracks.create_track(db, user_id, TrackCreate(name=f"T{i}"))

    async def test_needs_a_resume_type_unless_broad(self):
        with pytest.raises(ValidationError, match="Choose a resume type"):
            MissionCreate(source="linkedin")

    async def test_no_resume_no_start(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="b3@test.dev")
        with pytest.raises(HTTPException) as e:
            await _broad(maker, "b3@test.dev", resume=False)
        assert e.value.status_code == 422 and "resume" in e.value.detail


@pytest.mark.asyncio
class TestClaudeChoosesTheTitles:
    async def test_brief_has_no_link_until_titles_are_set(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="c1@test.dev")
        await _broad(maker, "c1@test.dev")
        out = await mcp_mod.get_scout_brief()
        assert out["broad"] is True and out["start_urls"] == []
        assert out["resume_types"] == [
            {"name": "IT Admin", "titles": ["IT Systems Administrator"]}
        ]
        assert out["max_titles"] == 8 and out["titles_tried"] == []
        assert "set_search_titles" in out["next"]
        assert "set_search_titles" in out["broad_steps"]

    async def test_the_app_builds_the_link_with_the_users_filters(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="c2@test.dev")
        _, _, run_id = await _broad(maker, "c2@test.dev")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.set_search_titles(str(run_id), TITLES)
        assert out["titles"] == TITLES and out["dropped"] == []
        (url,) = out["start_urls"]
        q = parse_qs(urlsplit(url).query)
        assert q["keywords"] == [" OR ".join(f'"{t}"' for t in TITLES)]
        assert q["location"] == ["Springfield, IL"] and q["distance"] == ["25"]
        assert q["f_TPR"] == ["r259200"]
        brief = await mcp_mod.get_scout_brief(str(run_id))  # a fresh chat
        assert brief["start_urls"] == [url]
        page = await mcp_mod.check_jobs(
            str(run_id), [{"company": "Vellacor", "title": "IT Systems Administrator"}]
        )
        assert page["next_page_url"] == url + "&start=25"

    async def test_tidies_dedupes_and_caps_at_eight(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="c3@test.dev")
        _, _, run_id = await _broad(maker, "c3@test.dev")
        await mcp_mod.get_scout_brief()
        sent = ["  IT   Systems Administrator ", "it systems administrator", "", 7]
        sent += [f"Title {i}" for i in range(9)]
        out = await mcp_mod.set_search_titles(str(run_id), sent)
        assert out["titles"][0] == "IT Systems Administrator"
        assert len(out["titles"]) == 8
        assert [d["why"] for d in out["dropped"]] == ["over_the_limit"] * 2

    async def test_nothing_searchable_is_an_error(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="c4@test.dev")
        _, _, run_id = await _broad(
            maker, "c4@test.dev", overrides=Overrides(never=["Help Desk Technician"])
        )
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="Choose other titles"):
            await mcp_mod.set_search_titles(str(run_id), ["help desk technician"])
        with pytest.raises(ValueError, match="Choose other titles"):
            await mcp_mod.set_search_titles(str(run_id), [])

    async def test_titles_are_fixed_once_results_are_read(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="c5@test.dev")
        _, mission_id, run_id = await _broad(maker, "c5@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.set_search_titles(str(run_id), TITLES[:1])
        # Before any results: Claude can still change its mind.
        out = await mcp_mod.set_search_titles(str(run_id), TITLES[1:])
        assert out["titles"] == TITLES[1:]
        await mcp_mod.check_jobs(
            str(run_id),
            [{"company": "Vellacor", "title": "Microsoft 365 Administrator"}],
        )
        out = await mcp_mod.set_search_titles(str(run_id), ["Something Else"])
        assert out["titles"] == TITLES[1:] and "set" in out["note"]
        async with maker() as db:
            rows = (await db.scalars(select(ScoutTitle))).all()
            # Each title counted once for this run, however often it was set.
            assert sorted((r.title, r.runs) for r in rows) == sorted(
                (t, 1) for t in TITLES
            )

    async def test_only_broad_searches_take_titles(self, engine, monkeypatch):
        from tests.test_mcp_scout import _setup

        maker = await _connected_user(engine, monkeypatch, email="c6@test.dev")
        _, _, run_id = await _setup(maker, "c6@test.dev")
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="resume type's titles"):
            await mcp_mod.set_search_titles(str(run_id), TITLES)

    async def test_local_companies_search_for_companies_that_hire_them(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="c7@test.dev")
        _, _, run_id = await _broad(maker, "c7@test.dev", source="local_companies")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.set_search_titles(str(run_id), TITLES)
        first = parse_qs(urlsplit(out["start_urls"][0]).query)["q"][0]
        assert first.startswith(
            "companies that hire IT Systems Administrator within 25"
        )
        assert "check_companies" in out["next"]


@pytest.mark.asyncio
class TestGoodFits:
    async def test_closest_resume_type_and_the_title_credited(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="g1@test.dev")
        user_id, mission_id, run_id = await _broad(maker, "g1@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.set_search_titles(str(run_id), TITLES)
        out = await _report_fit(
            maker, user_id, run_id, 1, "Senior Microsoft 365 Admin", 8, " it  ADMIN "
        )
        assert out["outcome"] == "picked"
        await _report_fit(maker, user_id, run_id, 2, "Payroll Clerk", 7, "Nope")
        await _report_fit(maker, user_id, run_id, 3, "Access Analyst", 3, "IT Admin")
        async with maker() as db:
            found = {f.title: f for f in (await db.scalars(select(ScoutFinding))).all()}
            admin = await db.scalar(
                select(ResumeTrack.id).where(ResumeTrack.name == "IT Admin")
            )
            assert found["Senior Microsoft 365 Admin"].closest_track_id == admin
            assert (
                found["Senior Microsoft 365 Admin"].search_title
                == "Microsoft 365 Administrator"
            )
            assert found["Payroll Clerk"].closest_track_id is None
            # No words in common: the first title gets it.
            assert found["Payroll Clerk"].search_title == TITLES[0]
            # Below the bar: no credit.
            assert found["Access Analyst"].search_title is None
            fits = {
                r.title: r.good_fits
                for r in (await db.scalars(select(ScoutTitle))).all()
            }
            assert fits == {TITLES[0]: 1, TITLES[1]: 1, TITLES[2]: 0}
            run = await db.get(ScoutRun, run_id)
            (out,) = await scout_runs.runs_out(db, [run], with_findings=True)
            assert out.broad is True
            assert [(t.title, t.good_fits) for t in out.titles] == [
                (TITLES[0], 1),
                (TITLES[1], 1),
                (TITLES[2], 0),
            ]
            names = {f.title: f.closest_track_name for f in out.findings}
            assert names["Senior Microsoft 365 Admin"] == "IT Admin"
            assert out.folder.name == "Claude's picks"

    async def test_saving_tags_the_closest_resume_type(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="g2@test.dev")
        user_id, _, run_id = await _broad(maker, "g2@test.dev", auto_save=True)
        await mcp_mod.get_scout_brief()
        await mcp_mod.set_search_titles(str(run_id), TITLES)
        out = await _report_fit(
            maker, user_id, run_id, 4, "IT Systems Administrator", 9, "IT Admin"
        )
        assert out["outcome"] == "saved"
        await _report_fit(maker, user_id, run_id, 5, "Access Analyst II", 9, "")
        async with maker() as db:
            admin = await db.scalar(
                select(ResumeTrack.id).where(ResumeTrack.name == "IT Admin")
            )
            tracks = sorted(
                str(t) for t in (await db.scalars(select(SavedJob.track_id))).all()
            )
            # Never the hidden broad track.
            assert tracks == sorted([str(admin), "None"])

    def test_best_title_counts_words_in_common(self):
        assert best_title("Sr. Identity & Access Analyst", TITLES) == TITLES[2]
        assert best_title("Systems Administrator II", TITLES) == TITLES[0]
        assert best_title("", TITLES) == TITLES[0]
        assert best_title("Anything", []) is None


@pytest.mark.asyncio
class TestTitleMemory:
    async def test_next_run_is_told_how_each_title_did(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="m1@test.dev")
        user_id, mission_id, run_id = await _broad(maker, "m1@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.set_search_titles(str(run_id), TITLES)
        await _report_fit(maker, user_id, run_id, 6, "Microsoft 365 Administrator")
        await mcp_mod.finish_scout_run(str(run_id), "")
        second = await _queue(maker, user_id, mission_id)
        out = await mcp_mod.get_scout_brief(str(second))
        assert out["titles_tried"][0] == {
            "title": "Microsoft 365 Administrator",
            "runs": 1,
            "good_fits": 1,
            "resting": False,
        }
        assert len(out["titles_tried"]) == 3 and out["start_urls"] == []

    async def test_a_title_that_finds_nothing_three_times_rests_two_weeks(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="m2@test.dev")
        user_id, mission_id, run_id = await _broad(maker, "m2@test.dev")
        for _ in range(3):
            await mcp_mod.get_scout_brief(str(run_id))
            await mcp_mod.set_search_titles(str(run_id), ["Desktop Support"])
            await mcp_mod.finish_scout_run(str(run_id), "")
            run_id = await _queue(maker, user_id, mission_id)
        await mcp_mod.get_scout_brief(str(run_id))
        out = await mcp_mod.set_search_titles(
            str(run_id), ["Desktop Support", TITLES[0]]
        )
        assert out["titles"] == [TITLES[0]]
        assert out["dropped"] == [{"title": "Desktop Support", "why": "resting"}]
        async with maker() as db:
            assert scout_titles.is_resting(
                await db.scalar(
                    select(ScoutTitle).where(ScoutTitle.title == "Desktop Support")
                )
            )
        async with maker() as db:
            for row in (await db.scalars(select(ScoutTitle))).all():
                row.last_tried_at = datetime.now(UTC) - timedelta(days=15)
            await db.commit()
        await mcp_mod.finish_scout_run(str(run_id), "")
        run_id = await _queue(maker, user_id, mission_id)
        await mcp_mod.get_scout_brief(str(run_id))
        out = await mcp_mod.set_search_titles(str(run_id), ["Desktop Support"])
        assert out["titles"] == ["Desktop Support"]  # rested long enough


@pytest.mark.asyncio
class TestOverrides:
    def test_lists_are_tidied_and_limited(self):
        o = Overrides(always=[" IT  Admin", "it admin"], avoid=["sales"])
        assert o.always == ["IT Admin"] and o.never == []
        with pytest.raises(ValidationError):
            Overrides(never=[f"T{i}" for i in range(21)])
        with pytest.raises(ValidationError):
            Overrides(avoid=["x" * 81])

    async def test_always_first_never_out_avoid_skipped(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="o1@test.dev")
        user_id, _, run_id = await _broad(
            maker,
            "o1@test.dev",
            overrides=Overrides(
                always=["Jira Administrator"],
                never=["Help Desk Technician"],
                avoid=["sales"],
            ),
        )
        brief = await mcp_mod.get_scout_brief()
        assert brief["always"] == ["Jira Administrator"]
        assert brief["never"] == ["Help Desk Technician"]
        assert brief["avoid"] == ["sales"]
        out = await mcp_mod.set_search_titles(
            str(run_id), ["HELP DESK TECHNICIAN", TITLES[0]]
        )
        assert out["titles"] == ["Jira Administrator", TITLES[0]]
        assert out["dropped"] == [
            {"title": "HELP DESK TECHNICIAN", "why": "never_search"}
        ]
        page = await mcp_mod.check_jobs(
            str(run_id),
            [
                {"company": "Vellacor", "title": "IT Sales Engineer"},
                {"company": "Quillstone", "title": "Jira Administrator"},
            ],
        )
        assert page["open"] == [1] and page["skipped"]["excluded"] == 1

    async def test_changes_apply_from_the_next_run(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="o2@test.dev")
        user_id, mission_id, run_id = await _broad(maker, "o2@test.dev")
        await mcp_mod.get_scout_brief()
        async with maker() as db:
            await scout_runs.update_mission(
                db,
                mission_id,
                user_id,
                MissionUpdate(overrides=Overrides(never=[TITLES[0]])),
            )
            await db.commit()
        out = await mcp_mod.set_search_titles(str(run_id), TITLES[:1])
        assert out["titles"] == TITLES[:1]  # the running run keeps its settings
        await mcp_mod.finish_scout_run(str(run_id), "")
        second = await _queue(maker, user_id, mission_id)
        await mcp_mod.get_scout_brief(str(second))
        out = await mcp_mod.set_search_titles(str(second), TITLES[:2])
        assert out["titles"] == TITLES[1:2]
        # Clearing them hands it all back to Claude.
        async with maker() as db:
            await scout_runs.update_mission(
                db, mission_id, user_id, MissionUpdate(overrides=None)
            )
            await db.commit()
            m = await scout_runs.get_mission(db, mission_id, user_id)
            assert m.overrides is None

    async def test_switching_a_search_back_needs_a_resume_type(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="o3@test.dev")
        user_id, mission_id, _ = await _broad(maker, "o3@test.dev")
        async with maker() as db:
            with pytest.raises(HTTPException) as e:
                await scout_runs.update_mission(
                    db, mission_id, user_id, MissionUpdate(broad=False)
                )
            assert e.value.status_code == 422
            admin = await db.scalar(
                select(ResumeTrack.id).where(ResumeTrack.name == "IT Admin")
            )
            m = await scout_runs.update_mission(
                db, mission_id, user_id, MissionUpdate(broad=False, track_id=admin)
            )
            assert m.track_id == admin
            m = await scout_runs.update_mission(
                db, mission_id, user_id, MissionUpdate(broad=True)
            )
            assert m.track_id != admin
            assert isinstance(m.id, uuid.UUID)
