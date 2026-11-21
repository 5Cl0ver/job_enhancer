"""Claude Scout's "Local companies" search, the way Claude in Chrome calls it.

No job boards: Claude finds businesses near the user on Google and the app says
which to visit. Each run mostly visits companies never checked, plus up to 3
checked at least a week ago (ones that had openings first); never one the user
said to skip. Invented companies throughout.
"""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.scout import ScoutCompany, ScoutRun
from app.models.user import User
from app.schemas.scout import CaptureIn, MissionCreate, TrackCreate
from app.services import scout_runs, scout_tracks
from app.services.scout_companies import (
    MAX_COMPANIES_PER_RUN,
    MAX_RECHECKS_PER_RUN,
    site_key,
    summary,
)
from tests.test_mcp_server import _connected_user

POSTING = (
    "Brambleworks is hiring an IT Systems Administrator to run Microsoft 365 and "
    "Entra ID for 400 staff at our Springfield office.\n\n"
    "Responsibilities\n- Manage users and devices in Intune\n- Automate onboarding\n"
)


async def _setup(maker, email, *, source="local_companies", job_count=2):
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == email))
        track = await scout_tracks.create_track(
            db,
            user.id,
            TrackCreate(
                name="IT Admin",
                target_titles=["IT Systems Administrator", "Help Desk Technician"],
                key_skills=["Microsoft 365"],
            ),
        )
        mission = await scout_runs.create_mission(
            db,
            user.id,
            MissionCreate(
                source=source,
                track_id=track.id,
                job_count=job_count,
                location="Springfield, IL",
            ),
        )
        run = await scout_runs.queue_run(db, mission.id, user.id)
        await db.commit()
        return user.id, mission.id, run.id


async def _company(maker, user_id, name, site, *, days_ago, result="none", **kw):
    async with maker() as db:
        db.add(
            ScoutCompany(
                id=uuid.uuid4(),
                user_id=user_id,
                key=site_key(site),
                name=name,
                website=f"https://{site}",
                last_checked_at=datetime.now(UTC) - timedelta(days=days_ago),
                times_checked=1,
                last_result=result,
                **kw,
            )
        )
        await db.commit()


def _co(name, site):
    return {"name": name, "website": f"https://www.{site}/"}


class TestSiteKey:
    @pytest.mark.parametrize(
        ("website", "key"),
        [
            ("https://www.brambleworks.example/about", "brambleworks.example"),
            ("brambleworks.example", "brambleworks.example"),
            ("https://careers.brambleworks.example", "brambleworks.example"),
            ("https://www.quillstone.co.uk/", "quillstone.co.uk"),
            ("https://vellacor.wixsite.com/home", "vellacor.wixsite.com"),
            ("https://vellacor.herokuapp.com/", "vellacor.herokuapp.com"),
            # Towns, counties and school districts are each their own place.
            ("https://www.springfield.il.us/jobs", "springfield.il.us"),
            ("https://district186.k12.il.us/", "district186.k12.il.us"),
            ("https://co.sangamon.il.us", "co.sangamon.il.us"),
            ("", None),
            ("not a site", None),
        ],
    )
    def test_one_key_per_company_site(self, website, key):
        assert site_key(website) == key


class TestStartUrls:
    def _criteria(self, **over):
        return {
            "source": "local_companies",
            "posted_within_days": 7,
            "location": "Springfield, IL",
            "remote": "any",
            "radius_miles": None,
            "track": {"name": "IT Admin", "titles": ["IT Systems Administrator"]},
            **over,
        }

    def _queries(self, **over):
        return [
            parse_qs(urlsplit(u).query)["q"][0]
            for u in scout_runs.start_urls(self._criteria(**over))
        ]

    def test_google_searches_for_businesses_not_jobs(self):
        queries = self._queries()
        assert len(queries) == 3
        assert all("near Springfield, IL" in q for q in queries)
        assert all("-indeed -linkedin -glassdoor -ziprecruiter" in q for q in queries)
        assert queries[0].startswith("IT Admin companies")

    def test_each_run_moves_on_to_different_searches(self):
        first, second = self._queries(round=0), self._queries(round=1)
        assert not set(first) & set(second)
        assert second[0].startswith("companies that hire IT Systems Administrator")

    def test_a_radius_reads_as_miles(self):
        assert "within 25 miles of Springfield, IL" in self._queries(radius_miles=25)[0]

    def test_google_jobs_opens_googles_job_results(self):
        (url,) = scout_runs.start_urls(self._criteria(source="google_jobs"))
        q = parse_qs(urlsplit(url).query)
        assert url.startswith("https://www.google.com/search?")
        assert q["udm"] == ["8"]
        assert q["q"] == [
            "IT Systems Administrator jobs within 25 miles of Springfield, IL"
        ]

    def test_google_jobs_remote_only(self):
        (url,) = scout_runs.start_urls(
            self._criteria(source="google_jobs", remote="remote_only")
        )
        assert parse_qs(urlsplit(url).query)["q"] == [
            "IT Systems Administrator remote jobs"
        ]


@pytest.mark.asyncio
class TestMissions:
    async def test_a_local_search_needs_a_place(self, client: AsyncClient):
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        r = await client.post(
            "/v1/scout/missions",
            json={"source": "local_companies", "track_id": track["id"]},
        )
        assert r.status_code == 422
        assert "city or area" in r.text
        r = await client.post(
            "/v1/scout/missions",
            json={
                "source": "local_companies",
                "track_id": track["id"],
                "location": "Springfield, IL",
                "remote": "remote_only",
            },
        )
        assert r.status_code == 422

    async def test_editing_a_local_search_keeps_its_place(self, client: AsyncClient):
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        mission = (
            await client.post(
                "/v1/scout/missions",
                json={
                    "source": "local_companies",
                    "track_id": track["id"],
                    "location": "Springfield, IL",
                },
            )
        ).json()
        assert mission["name"].startswith("Local companies · IT Admin")
        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}", json={"location": None}
        )
        assert r.status_code == 422
        # Google Jobs is fine anywhere.
        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}",
            json={"source": "google_jobs", "location": None},
        )
        assert r.status_code == 200 and r.json()["name"].startswith("Google Jobs")


@pytest.mark.asyncio
class TestCheckCompanies:
    async def test_new_companies_are_visited_and_remembered(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="lc1@test.dev")
        user_id, _, run_id = await _setup(maker, "lc1@test.dev")
        brief = await mcp_mod.get_scout_brief()
        assert brief["source"] == "local_companies"
        assert "LOCAL COMPANIES" in brief["source_steps"]
        assert brief["recheck"] == []
        assert "check_companies" in brief["next"]
        out = await mcp_mod.check_companies(
            str(run_id),
            [
                _co("Brambleworks", "brambleworks.example"),
                _co("Indeed", "indeed.com"),
                {"name": "Quillstone Dental", "website": ""},
                _co("Brambleworks Inc.", "brambleworks.example"),  # twice on the page
                _co("Vellacor", "vellacor.example"),
            ],
        )
        assert [v["i"] for v in out["visit"]] == [0, 4]
        assert out["skipped"] == {"job_site": 1, "no_website": 1, "checked_this_run": 1}
        assert out["companies"] == {"checked": 2, "limit": MAX_COMPANIES_PER_RUN}
        async with maker() as db:
            rows = (
                await db.scalars(
                    select(ScoutCompany).where(ScoutCompany.user_id == user_id)
                )
            ).all()
        assert sorted(c.key for c in rows) == [
            "brambleworks.example",
            "vellacor.example",
        ]
        assert all(c.times_checked == 1 and c.last_checked_at for c in rows)

    async def test_checked_in_the_last_week_is_left_alone(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="lc2@test.dev")
        user_id, _, run_id = await _setup(maker, "lc2@test.dev")
        await _company(
            maker, user_id, "Brambleworks", "brambleworks.example", days_ago=3
        )
        await _company(
            maker,
            user_id,
            "Quillstone",
            "quillstone.example",
            days_ago=30,
            never_check=True,
        )
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.check_companies(
            str(run_id),
            [
                _co("Brambleworks", "brambleworks.example"),
                _co("Quillstone", "quillstone.example"),
            ],
        )
        assert out["visit"] == []
        assert out["skipped"] == {"checked_recently": 1, "skipped_by_you": 1}
        assert "next start URL" in out["next"]

    async def test_a_week_on_a_few_are_checked_again_openings_first(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="lc3@test.dev")
        user_id, _, run_id = await _setup(maker, "lc3@test.dev")
        for i in range(5):
            await _company(
                maker, user_id, f"Old {i}", f"old{i}.example", days_ago=10 + i
            )
        await _company(
            maker,
            user_id,
            "Hiring Co",
            "hiring.example",
            days_ago=8,
            result="openings",
            careers_url="https://hiring.example/careers",
        )
        await _company(maker, user_id, "Fresh", "fresh.example", days_ago=2)
        brief = await mcp_mod.get_scout_brief()
        names = [c["name"] for c in brief["recheck"]]
        assert len(names) == MAX_RECHECKS_PER_RUN
        assert names[0] == "Hiring Co"
        assert brief["recheck"][0]["careers_url"] == "https://hiring.example/careers"
        assert "Fresh" not in names
        assert "recheck" in brief["next"]
        # A new chat on the same run gets the same ones, not three more.
        again = await mcp_mod.get_scout_brief()
        assert again["recheck"] == brief["recheck"]
        assert again["companies"]["checked"] == MAX_RECHECKS_PER_RUN
        # The re-check slots are used up: other due companies wait for next time.
        out = await mcp_mod.check_companies(
            str(run_id), [_co("Old 0", "old0.example"), _co("New", "new.example")]
        )
        assert [v["i"] for v in out["visit"]] == [1]

    async def test_the_company_limit_ends_the_run(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="lc4@test.dev")
        _, _, run_id = await _setup(maker, "lc4@test.dev")
        await mcp_mod.get_scout_brief()
        first = [_co(f"Co {i}", f"co{i}.example") for i in range(12)]
        await mcp_mod.check_companies(str(run_id), first)
        more = [_co(f"Co {i}", f"co{i}.example") for i in range(12, 20)]
        out = await mcp_mod.check_companies(str(run_id), more)
        assert len(out["visit"]) == MAX_COMPANIES_PER_RUN - 12
        assert out["skipped"] == {"over_the_limit": 5}
        assert out["companies"]["checked"] == MAX_COMPANIES_PER_RUN

    async def test_only_for_a_local_search(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="lc5@test.dev")
        _, _, run_id = await _setup(maker, "lc5@test.dev", source="google_jobs")
        brief = await mcp_mod.get_scout_brief()
        assert "GOOGLE JOBS" in brief["source_steps"] and "recheck" not in brief
        with pytest.raises(ValueError, match="only for a Local companies search"):
            await mcp_mod.check_companies(str(run_id), [_co("A", "a.example")])

    async def test_too_many_at_once_is_refused(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="lc6@test.dev")
        _, _, run_id = await _setup(maker, "lc6@test.dev")
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="at most 20"):
            await mcp_mod.check_companies(
                str(run_id), [_co(f"C{i}", f"c{i}.example") for i in range(21)]
            )


@pytest.mark.asyncio
class TestCompanyChecked:
    async def test_records_what_the_site_had(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="cc1@test.dev")
        user_id, _, run_id = await _setup(maker, "cc1@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_companies(
            str(run_id),
            [
                _co("Brambleworks", "brambleworks.example"),
                _co("Vellacor", "vellacor.example"),
            ],
        )
        out = await mcp_mod.company_checked(
            str(run_id),
            "brambleworks.example",
            "openings",
            careers_url="https://brambleworks.example/careers",
        )
        assert out["recorded"] == "openings"
        # Saying it twice doesn't count twice.
        await mcp_mod.company_checked(
            str(run_id), "https://brambleworks.example", "openings"
        )
        await mcp_mod.company_checked(str(run_id), "vellacor.example", "no_careers")
        async with maker() as db:
            rows = {
                c.key: c
                for c in await db.scalars(
                    select(ScoutCompany).where(ScoutCompany.user_id == user_id)
                )
            }
            run = await db.get(ScoutRun, run_id)
        assert rows["brambleworks.example"].last_result == "openings"
        assert (
            rows["brambleworks.example"].careers_url
            == "https://brambleworks.example/careers"
        )
        assert rows["vellacor.example"].last_result == "no_careers"
        assert run.stats["companies_with_openings"] == 1
        assert (
            summary(run.stats) == "Checked 2 local companies (2 new); 1 had openings."
        )

    async def test_a_careers_page_on_a_job_board_isnt_kept(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="cc2@test.dev")
        user_id, _, run_id = await _setup(maker, "cc2@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_companies(
            str(run_id), [_co("Vellacor", "vellacor.example")]
        )
        await mcp_mod.company_checked(
            str(run_id),
            "vellacor.example",
            "openings",
            careers_url="https://www.indeed.com/cmp/Vellacor/jobs",
        )
        async with maker() as db:
            company = await db.scalar(
                select(ScoutCompany).where(ScoutCompany.user_id == user_id)
            )
        assert company.careers_url is None

    async def test_bad_result_and_unknown_company(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="cc3@test.dev")
        _, _, run_id = await _setup(maker, "cc3@test.dev")
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="result must be one of"):
            await mcp_mod.company_checked(str(run_id), "a.example", "maybe")
        with pytest.raises(ValueError, match="check_companies first"):
            await mcp_mod.company_checked(str(run_id), "nobody.example", "none")


@pytest.mark.asyncio
class TestReportAndFinish:
    async def test_only_the_companys_own_pages_are_taken(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="rf1@test.dev")
        user_id, _, run_id = await _setup(maker, "rf1@test.dev")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.report_job(
            str(run_id), "https://www.indeed.com/viewjob?jk=abc123", 8, "fits", "none"
        )
        assert out["outcome"] == "rejected_link"
        assert "companies' own sites" in out["reason"]
        url = "https://brambleworks.example/careers/it-systems-administrator"
        async with maker() as db:
            assert await scout_runs.record_capture(
                db,
                user_id,
                CaptureIn(
                    url=url,
                    title="IT Systems Administrator",
                    company="Brambleworks",
                    description=POSTING * 2,
                ),
            )
            await db.commit()
        out = await mcp_mod.report_job(
            str(run_id), url, 8, "Runs Microsoft 365", "None"
        )
        assert out["outcome"] == "picked"

    async def test_finish_says_how_many_companies(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="rf2@test.dev")
        _, _, run_id = await _setup(maker, "rf2@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_companies(
            str(run_id), [_co("A", "a.example"), _co("B", "b.example")]
        )
        await mcp_mod.company_checked(str(run_id), "a.example", "none")
        out = await mcp_mod.finish_scout_run(str(run_id))
        assert (
            "Checked 2 local companies (2 new); 0 had openings. Nothing new"
            in out["next"]
        )

    async def test_google_links_are_never_the_posting(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="rf3@test.dev")
        _, _, run_id = await _setup(maker, "rf3@test.dev", source="google_jobs")
        await mcp_mod.get_scout_brief()
        out = await mcp_mod.report_job(
            str(run_id),
            "https://www.google.com/search?q=it+admin+jobs&udm=8#vhid=abc",
            8,
            "fits",
            "none",
        )
        assert out["outcome"] == "rejected_link" and "Apply on" in out["reason"]


@pytest.mark.asyncio
class TestRoundsMoveOn:
    async def test_each_run_of_a_search_gets_the_next_searches(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="rd@test.dev")
        user_id, mission_id, first = await _setup(maker, "rd@test.dev")
        async with maker() as db:
            second = await scout_runs.queue_run(db, mission_id, user_id)
            await db.commit()
            a = (await db.get(ScoutRun, first)).criteria
            b = second.criteria
        assert (a["round"], b["round"]) == (0, 1)
        assert not set(scout_runs.start_urls(a)) & set(scout_runs.start_urls(b))


@pytest.mark.asyncio
class TestCompaniesPage:
    async def _seed(self, db_session, test_user):
        company = ScoutCompany(
            id=uuid.uuid4(),
            user_id=test_user.id,
            key="brambleworks.example",
            name="Brambleworks",
            website="https://brambleworks.example",
            last_checked_at=datetime.now(UTC) - timedelta(days=2),
            times_checked=1,
            last_result="none",
        )
        db_session.add(company)
        await db_session.commit()
        return company.id

    async def test_lists_and_changes_them(
        self, client: AsyncClient, db_session, test_user
    ):
        cid = await self._seed(db_session, test_user)
        (row,) = (await client.get("/v1/scout/companies")).json()
        assert row["name"] == "Brambleworks" and row["due"] is False
        r = await client.patch(f"/v1/scout/companies/{cid}", json={"check_next": True})
        assert r.json()["due"] is True and r.json()["last_checked_at"] is None
        r = await client.patch(f"/v1/scout/companies/{cid}", json={"never_check": True})
        assert r.json()["never_check"] is True and r.json()["due"] is False

    async def test_someone_elses_company_is_not_found(self, client: AsyncClient):
        r = await client.patch(
            f"/v1/scout/companies/{uuid.uuid4()}", json={"never_check": True}
        )
        assert r.status_code == 404


@pytest.mark.asyncio
class TestReviewFixes:
    async def test_a_new_chat_gets_back_companies_not_reported_yet(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="nc@test.dev")
        _, _, run_id = await _setup(maker, "nc@test.dev")
        await mcp_mod.get_scout_brief()
        page = [_co("A", "a.example"), _co("B", "b.example")]
        await mcp_mod.check_companies(str(run_id), page)
        await mcp_mod.company_checked(str(run_id), "a.example", "none")
        # The first chat ran out before B. The next one sees the same page.
        out = await mcp_mod.check_companies(str(run_id), page)
        assert [v["i"] for v in out["visit"]] == [1]
        assert out["skipped"] == {"checked_this_run": 1}
        assert out["companies"]["checked"] == 2  # not counted twice

    async def test_a_new_chat_only_rechecks_what_wasnt_reported(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="nr@test.dev")
        user_id, _, run_id = await _setup(maker, "nr@test.dev")
        await _company(maker, user_id, "Old A", "olda.example", days_ago=9)
        await _company(maker, user_id, "Old B", "oldb.example", days_ago=8)
        first = await mcp_mod.get_scout_brief()
        assert len(first["recheck"]) == 2
        await mcp_mod.company_checked(str(run_id), "olda.example", "none")
        again = await mcp_mod.get_scout_brief()
        assert [c["name"] for c in again["recheck"]] == ["Old B"]

    async def test_only_a_company_this_run_handed_out_can_be_reported(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="ho@test.dev")
        user_id, _, run_id = await _setup(maker, "ho@test.dev")
        await _company(maker, user_id, "Fresh", "fresh.example", days_ago=1)
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="check_companies first"):
            await mcp_mod.company_checked(str(run_id), "fresh.example", "openings")

    async def test_a_corrected_report_counts_once(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="cr@test.dev")
        _, _, run_id = await _setup(maker, "cr@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_companies(str(run_id), [_co("A", "a.example")])
        await mcp_mod.company_checked(str(run_id), "a.example", "openings")
        await mcp_mod.company_checked(str(run_id), "a.example", "none")
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
        assert run.stats["companies_with_openings"] == 0

    async def test_odd_rows_and_long_links_dont_break_it(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="od@test.dev")
        user_id, _, run_id = await _setup(maker, "od@test.dev")
        await mcp_mod.get_scout_brief()
        long_site = "https://www.vellacor.example/?" + "utm=x&" * 200
        out = await mcp_mod.check_companies(
            str(run_id),
            ["Brambleworks", {"name": "Vellacor", "website": long_site}],
        )
        assert [v["i"] for v in out["visit"]] == [1]
        assert out["skipped"] == {"no_website": 1}
        async with maker() as db:
            company = await db.scalar(
                select(ScoutCompany).where(ScoutCompany.user_id == user_id)
            )
        assert len(company.website) <= 500

    async def test_company_checked_is_only_for_a_local_search(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="ol@test.dev")
        _, _, run_id = await _setup(maker, "ol@test.dev", source="google_jobs")
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="only for a Local companies search"):
            await mcp_mod.company_checked(str(run_id), "a.example", "none")


@pytest.mark.asyncio
class TestPageCopiesBeyondTheBoards:
    """Job Catcher copies pages on other sites only while a Google Jobs or
    Local companies search is running, so ordinary browsing is never kept."""

    async def _capture(self, maker, user_id, url):
        async with maker() as db:
            stored = await scout_runs.record_capture(
                db,
                user_id,
                CaptureIn(
                    url=url,
                    title="IT Systems Administrator",
                    company="Brambleworks",
                    description=POSTING * 2,
                ),
            )
            await db.commit()
            return stored

    async def test_only_while_a_local_or_google_search_is_running(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="pc1@test.dev")
        user_id, _, _ = await _setup(maker, "pc1@test.dev")
        url = "https://brambleworks.example/careers/it-admin-1"
        # Queued: Claude hasn't started, nothing is copied.
        assert not await self._capture(maker, user_id, url)
        await mcp_mod.get_scout_brief()
        assert await self._capture(maker, user_id, url)

    async def test_never_during_a_job_board_search(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="pc2@test.dev")
        user_id, _, _ = await _setup(maker, "pc2@test.dev", source="linkedin")
        await mcp_mod.get_scout_brief()
        assert not await self._capture(
            maker, user_id, "https://brambleworks.example/careers/it-admin-1"
        )
        assert await self._capture(
            maker, user_id, "https://www.linkedin.com/jobs/view/4012345678/"
        )

    async def test_the_extension_is_told(self, client: AsyncClient, db_session):
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        mission = (
            await client.post(
                "/v1/scout/missions",
                json={
                    "source": "local_companies",
                    "track_id": track["id"],
                    "location": "Springfield, IL",
                },
            )
        ).json()
        run = (await client.post(f"/v1/scout/missions/{mission['id']}/runs")).json()
        active = (await client.get("/v1/scout/runs/active")).json()
        assert active == {"run_id": run["id"], "any_site": False}
        row = await db_session.get(ScoutRun, uuid.UUID(run["id"]))
        row.status = "running"
        await db_session.commit()
        assert (await client.get("/v1/scout/runs/active")).json()["any_site"] is True

    async def test_an_old_run_left_running_doesnt_hide_a_local_one(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="pc3@test.dev")
        user_id, _, old_run = await _setup(maker, "pc3@test.dev", source="linkedin")
        await mcp_mod.get_scout_brief()  # left running
        async with maker() as db:
            track = await scout_tracks.create_track(
                db, user_id, TrackCreate(name="Help Desk")
            )
            mission = await scout_runs.create_mission(
                db,
                user_id,
                MissionCreate(
                    source="local_companies",
                    track_id=track.id,
                    location="Springfield, IL",
                ),
            )
            local_run = await scout_runs.queue_run(db, mission.id, user_id)
            await db.commit()
        await mcp_mod.get_scout_brief(str(local_run.id))
        assert await self._capture(
            maker, user_id, "https://brambleworks.example/careers/it-admin-1"
        )
        assert old_run != local_run.id


@pytest.mark.asyncio
async def test_each_companys_openings_arent_counted_as_results_pages(
    engine, monkeypatch
):
    """A run reads at most 4 pages of a board's results; a Local companies run
    checks many companies' openings and is never told it's out of pages."""
    maker = await _connected_user(engine, monkeypatch, email="lpages@test.dev")
    _, _, run_id = await _setup(maker, "lpages@test.dev", job_count=10)
    brief = await mcp_mod.get_scout_brief()
    assert "max_pages" not in brief
    for n in range(6):
        row = {
            "company": f"Brambleworks {n}",
            "title": "IT Systems Administrator",
            "url": f"https://brambleworks{n}.example/careers/it-admin",
        }
        out = await mcp_mod.check_jobs(str(run_id), [row])
        assert out["open"] == [0] and "next_page_url" not in out
        assert "company_checked" in out["next"] and "last" not in out["next"]
