"""Sites to skip (spec 024): the list, its routes, and what Claude is told.

Matching is exact host or a real sub-site, never a look-alike (research R5).
Claude Scout leaves rows on a skipped site out and turns down reports of them;
Apply with Claude is told to find the company's own posting. Invented
companies throughout.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.models.scout import ScoutFinding, ScoutRun
from app.models.skipped_site import SkippedSite
from app.models.user import User
from app.services import apply_runs
from app.services import skipped_sites as svc
from app.services.users import create_user
from tests.test_mcp_scout import _capture, _setup
from tests.test_mcp_server import _connected_user

PASTED = "https://www.learn4good.com/jobs/online_remote/engineering/5663701391/e/"


# --------------------------------------------------------------------------- #
# Reading a site from what the user pastes, and matching
# --------------------------------------------------------------------------- #
class TestHostOf:
    @pytest.mark.parametrize(
        "text, host",
        [
            (PASTED, "learn4good.com"),
            ("learn4good.com", "learn4good.com"),
            ("  WWW.Learn4Good.com/jobs  ", "learn4good.com"),
            ("uk.learn4good.com", "uk.learn4good.com"),
            # A redirect link: the link's own site.
            (
                "https://www.talent.com/redirect?id=1&to=https://acme.example",
                "talent.com",
            ),
            ("http://jobleads.com:8080/x", "jobleads.com"),
            ("www.www.learn4good.com", "learn4good.com"),
            # Only a scheme at the start counts: this is learn4good.com.
            ("learn4good.com/jobs?next=https://acme.example/x", "learn4good.com"),
            # International names are kept the way browsers give them.
            ("https://bücher.de/jobs", "xn--bcher-kva.de"),
            ("xn--bcher-kva.de", "xn--bcher-kva.de"),
        ],
    )
    def test_keeps_the_site(self, text, host):
        assert svc.host_of(text) == host

    @pytest.mark.parametrize(
        "text",
        [
            "hello",
            "",
            "   ",
            "learn 4 good.com",
            "mailto:me@learn4good.com",
            "javascript:alert(1)",
            "ftp://learn4good.com",
            "192.168.0.1",
            "-bad.com",
            "a" * 250 + ".com",
        ],
    )
    def test_refuses_what_isnt_a_site(self, text):
        assert svc.host_of(text) is None


class TestMatches:
    def test_the_site_and_its_sub_sites(self):
        assert svc.matches("learn4good.com", "learn4good.com")
        assert svc.matches("uk.learn4good.com", "learn4good.com")
        assert svc.matches("a.b.learn4good.com", "learn4good.com")

    def test_never_a_look_alike(self):
        assert not svc.matches("evil-learn4good.com", "learn4good.com")
        assert not svc.matches("learn4good.com.evil.example", "learn4good.com")
        assert not svc.matches("learn4good.co", "learn4good.com")
        # A sub-site on the list doesn't cover its parent.
        assert not svc.matches("learn4good.com", "uk.learn4good.com")

    def test_skipped_by_a_link(self):
        sites = ["jobleads.com", "learn4good.com"]
        assert svc.skipped_by(PASTED, sites) == "learn4good.com"
        assert svc.skipped_by("https://acme.example/jobs/1", sites) is None
        assert svc.skipped_by("not a link", sites) is None
        assert svc.skipped_by(PASTED, []) is None
        # A stored xn-- site matches the link's own international name.
        assert svc.skipped_by("https://www.bücher.de/x", ["xn--bcher-kva.de"])


# --------------------------------------------------------------------------- #
# The app's routes (owner only)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestRoutes:
    async def test_add_list_and_remove(self, client: AsyncClient):
        r = await client.post("/v1/skipped-sites", json={"site": PASTED})
        assert r.status_code == 201
        assert r.json()["host"] == "learn4good.com"
        assert r.json()["already"] is False
        site_id = r.json()["id"]

        r = await client.get("/v1/skipped-sites")
        assert r.status_code == 200
        assert [s["host"] for s in r.json()] == ["learn4good.com"]

        r = await client.delete(f"/v1/skipped-sites/{site_id}")
        assert r.status_code == 204
        assert (await client.get("/v1/skipped-sites")).json() == []

    async def test_adding_again_changes_nothing(self, client: AsyncClient):
        first = await client.post("/v1/skipped-sites", json={"site": "learn4good.com"})
        again = await client.post("/v1/skipped-sites", json={"site": PASTED})
        assert again.status_code == 200
        assert again.json() == {**first.json(), "already": True}
        # A sub-site of a listed site is covered already.
        sub = await client.post("/v1/skipped-sites", json={"site": "uk.learn4good.com"})
        assert sub.status_code == 200 and sub.json()["host"] == "learn4good.com"
        assert len((await client.get("/v1/skipped-sites")).json()) == 1

    async def test_text_that_isnt_a_site(self, client: AsyncClient):
        r = await client.post("/v1/skipped-sites", json={"site": "hello"})
        assert r.status_code == 400
        assert r.json()["detail"] == svc.NOT_A_SITE
        r = await client.post("/v1/skipped-sites", json={"site": ""})
        assert r.status_code == 422

    @pytest.mark.parametrize(
        "site",
        [
            "https://boards.greenhouse.io/acme/jobs/1",
            "job-boards.greenhouse.io",
            "https://jobs.lever.co/acme/123",
            "jobs.ashbyhq.com",
            "apply.workable.com",
            "jobs.smartrecruiters.com",
            "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/1",
            "careers-acme.icims.com",
            "jobs.jobvite.com",
            "acme.bamboohr.com",
        ],
    )
    async def test_an_application_system_cant_be_skipped(
        self, client: AsyncClient, site
    ):
        r = await client.post("/v1/skipped-sites", json={"site": site, "confirm": True})
        assert r.status_code == 400
        assert r.json()["detail"] == (
            "That's an application system many companies use, so it can't be skipped."
        )
        assert (await client.get("/v1/skipped-sites")).json() == []

    @pytest.mark.parametrize(
        "site", ["co.uk", "com.au", "github.io", "www.herokuapp.com", "pages.dev"]
    )
    async def test_a_shared_name_cant_be_skipped(self, client: AsyncClient, site):
        r = await client.post("/v1/skipped-sites", json={"site": site})
        assert r.status_code == 400
        assert r.json()["detail"] == svc.SHARED_HOST
        # One site on it can.
        r = await client.post("/v1/skipped-sites", json={"site": f"spam.{site}"})
        assert r.status_code == 201

    async def test_two_adds_at_once_give_already(
        self, client: AsyncClient, monkeypatch
    ):
        """A double tap: the other add's row lands between the check and the
        insert. The unique key holds, and the answer is "already"."""
        real = svc.list_sites

        async def racing(db, user_id):
            rows = await real(db, user_id)
            async with db.begin_nested():
                db.add(SkippedSite(user_id=user_id, host="learn4good.com"))
            return rows

        monkeypatch.setattr(svc, "list_sites", racing)
        r = await client.post("/v1/skipped-sites", json={"site": "learn4good.com"})
        monkeypatch.undo()
        assert r.status_code == 200
        assert r.json()["already"] is True
        assert len((await client.get("/v1/skipped-sites")).json()) == 1

    @pytest.mark.parametrize(
        "site", ["linkedin.com", "www.indeed.com", "ziprecruiter.com", "google.com"]
    )
    async def test_a_site_scout_searches_asks_first(self, client: AsyncClient, site):
        r = await client.post("/v1/skipped-sites", json={"site": site})
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert detail["needs_confirm"] is True
        assert detail["why"].startswith("Claude Scout searches ")
        assert (await client.get("/v1/skipped-sites")).json() == []

        r = await client.post("/v1/skipped-sites", json={"site": site, "confirm": True})
        assert r.status_code == 201

    async def test_at_most_100(self, client: AsyncClient, db_session, test_user):
        for i in range(svc.MAX_SITES):
            db_session.add(SkippedSite(user_id=test_user.id, host=f"site{i}.example"))
        await db_session.commit()
        r = await client.post("/v1/skipped-sites", json={"site": "learn4good.com"})
        assert r.status_code == 400
        assert "up to 100" in r.json()["detail"]
        # One already there is still "already", not an error.
        r = await client.post("/v1/skipped-sites", json={"site": "site7.example"})
        assert r.status_code == 200

    async def test_another_users_site_is_never_touched(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        other = await create_user(db_session, email="other@test.dev")
        theirs = SkippedSite(user_id=other.id, host="jobleads.com")
        db_session.add(theirs)
        await db_session.commit()
        assert (await client.get("/v1/skipped-sites")).json() == []
        r = await client.delete(f"/v1/skipped-sites/{theirs.id}")
        assert r.status_code == 404
        assert await db_session.get(SkippedSite, theirs.id) is not None
        r = await client.delete(f"/v1/skipped-sites/{uuid.uuid4()}")
        assert r.status_code == 404

    async def test_needs_sign_in(self, anon_client: AsyncClient):
        assert (await anon_client.get("/v1/skipped-sites")).status_code == 401
        r = await anon_client.post("/v1/skipped-sites", json={"site": "a.com"})
        assert r.status_code == 401

    async def test_suggestions_from_the_users_own_finds(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        urls = [
            PASTED,
            "https://uk.learn4good.com/jobs/2",
            "https://www.jobleads.com/us/job/3",
            "https://us.trabajo.org/job-1",
            # A company's own careers site is never suggested.
            "https://careers.acme.example/jobs/4",
            # A look-alike isn't the known site.
            "https://evil-jooble.org/x",
        ]
        for url in urls:
            db_session.add(
                ScoutFinding(
                    user_id=test_user.id,
                    run_id=uuid.uuid4(),
                    source="google_jobs",
                    url=url,
                    url_key=url,
                    outcome="picked",
                    fit_score=8,
                )
            )
        await db_session.commit()
        r = await client.get("/v1/skipped-sites/suggestions")
        assert r.status_code == 200
        assert r.json() == [
            {"host": "learn4good.com", "finds": 2},
            {"host": "jobleads.com", "finds": 1},
            {"host": "trabajo.org", "finds": 1},
        ]
        # Suggestions are never added on their own; a skipped one drops out.
        assert (await client.get("/v1/skipped-sites")).json() == []
        await client.post("/v1/skipped-sites", json={"site": "learn4good.com"})
        hosts = [
            s["host"]
            for s in (await client.get("/v1/skipped-sites/suggestions")).json()
        ]
        assert hosts == ["jobleads.com", "trabajo.org"]

    async def test_in_the_data_export(self, client: AsyncClient):
        await client.post("/v1/skipped-sites", json={"site": "jobleads.com"})
        data = (await client.get("/v1/users/me/export")).json()
        assert [s["host"] for s in data["skipped_sites"]] == ["jobleads.com"]


# --------------------------------------------------------------------------- #
# Claude Scout
# --------------------------------------------------------------------------- #
async def _skip(maker, email, *hosts):
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == email))
        for host in hosts:
            await svc.add(db, user.id, host, confirm=True)
        await db.commit()


@pytest.mark.asyncio
class TestScout:
    async def test_the_brief_lists_the_sites_only_when_there_are_some(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="sb@test.dev")
        await _setup(maker, "sb@test.dev")
        out = await mcp_mod.get_scout_brief()
        assert "skip_sites" not in out
        # The locked rule is always there, one line.
        assert "skip_sites" in out["playbook"]
        await _skip(maker, "sb@test.dev", "learn4good.com", "jobleads.com")
        out = await mcp_mod.get_scout_brief()
        assert out["skip_sites"] == ["jobleads.com", "learn4good.com"]

    async def test_check_jobs_leaves_skipped_rows_out(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="sc@test.dev")
        _, _, run_id = await _setup(maker, "sc@test.dev")
        await _skip(maker, "sc@test.dev", "learn4good.com")
        await mcp_mod.get_scout_brief()
        rows = [
            {
                "company": "Brambleworks",
                "title": "IT Systems Administrator",
                "url": PASTED,
            },
            {
                "company": "Quillstone",
                "title": "Jira Administrator",
                "url": "https://uk.learn4good.com/jobs/9",
            },
            {
                "company": "Vellacor",
                "title": "IT Systems Administrator",
                "url": "https://evil-learn4good.com/jobs/1",
            },
        ]
        out = await mcp_mod.check_jobs(str(run_id), rows)
        assert out["open"] == [2]
        assert out["skipped"]["skipped_site"] == 2
        # The run log counts them, the way it counts excluded words.
        async with maker() as db:
            assert (await db.get(ScoutRun, run_id)).stats["skipped_site"] == 2

    async def test_no_sites_no_change(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="sn@test.dev")
        _, _, run_id = await _setup(maker, "sn@test.dev")
        await mcp_mod.get_scout_brief()
        rows = [{"company": "Brambleworks", "title": "IT Systems Administrator"}]
        out = await mcp_mod.check_jobs(str(run_id), [{**rows[0], "url": PASTED}])
        assert out["open"] == [0]
        assert "skipped_site" not in out["skipped"]

    async def test_report_job_turns_down_a_skipped_link(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="sr@test.dev")
        user_id, _, run_id = await _setup(maker, "sr@test.dev")
        await _skip(maker, "sr@test.dev", "learn4good.com")
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id, url=PASTED)
        out = await mcp_mod.report_job(str(run_id), PASTED, 9, "Fits", "None")
        assert out["outcome"] == "rejected_link"
        assert out["reason"] == (
            "learn4good.com is on the user's sites to skip. Use the company's own "
            "posting, or another 'Apply on' link."
        )
        async with maker() as db:
            found = await db.scalar(
                select(ScoutFinding).where(ScoutFinding.run_id == run_id)
            )
            assert found is None  # nothing kept


# --------------------------------------------------------------------------- #
# Apply with Claude
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestApply:
    async def _run(self, engine, monkeypatch, apply_url):
        maker = await _connected_user(engine, monkeypatch)
        job = await mcp_mod.save_job(
            title="IT Systems Engineer",
            company="Acme",
            apply_url=apply_url,
            description="We need Intune, Okta and Jamf experience. " * 20,
        )
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
            await apply_runs.create_run(db, user, uuid.UUID(job["job_id"]))
            await db.commit()
        return maker

    async def test_flags_an_apply_link_on_a_skipped_site(self, engine, monkeypatch):
        maker = await self._run(engine, monkeypatch, PASTED)
        await _skip(maker, "claude@test.dev", "learn4good.com")
        out = await mcp_mod.get_apply_brief()
        assert out["apply_url_skipped"] is True
        assert "company's own posting" in out["next"]
        assert "need_help" in out["next"]

    async def test_nothing_extra_for_other_links(self, engine, monkeypatch):
        maker = await self._run(
            engine, monkeypatch, "https://acme.example/careers/jobs/123"
        )
        await _skip(maker, "claude@test.dev", "learn4good.com")
        out = await mcp_mod.get_apply_brief()
        assert "apply_url_skipped" not in out
        assert "sites to skip" not in out["next"]

    async def test_pages_on_a_skipped_site_are_refused(self, engine, monkeypatch):
        """Enforced on the server, not only said in the brief."""
        maker = await self._run(engine, monkeypatch, PASTED)
        await _skip(maker, "claude@test.dev", "learn4good.com")
        out = await mcp_mod.get_apply_brief()
        run_id = out["run_id"]
        page = "https://uk.learn4good.com/apply/5663701391"
        refused = "learn4good.com is on the user's sites to skip"
        with pytest.raises(ValueError, match=refused) as err:
            await mcp_mod.fill_page(run_id, page)
        assert "need_help" in str(err.value)
        with pytest.raises(ValueError, match=refused):
            await mcp_mod.page_done(run_id, page, "Apply", [])
        with pytest.raises(ValueError, match=refused):
            await mcp_mod.ready_for_review(run_id, page, "Review", [])
        async with maker() as db:
            run = await db.get(ApplyRun, uuid.UUID(run_id))
            assert run.pages == [] and "uk.learn4good.com" not in run.apply_hosts

        # The company's own posting is fine, and the brief still says why.
        async with maker() as db:
            user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
            await apply_runs.page_done(
                db, user, run_id, "https://acme.example/careers/apply", "Apply", []
            )
            await db.commit()
        out = await mcp_mod.get_apply_brief()
        assert out["pages_done"] == 1
        assert out["apply_url_skipped"] is True
        assert "company's own posting" in out["next"]
