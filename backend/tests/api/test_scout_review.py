"""Claude Scout asks before it saves: picks wait, the user ticks and confirms,
and each search chooses its collection.

Runs are driven through the same service calls Claude's connector makes, then
the page's endpoints are called as the user. Invented companies throughout.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.collection import Collection
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.models.scout import ScoutFinding
from app.schemas.scout import CaptureIn, MissionCreate, TrackCreate
from app.services import scout_runs, scout_tracks
from tests.api.test_scout_tracks import _other_user

POSTING = (
    "About the job\nWe run Microsoft 365 and Entra ID for 400 staff.\n\n"
    "Responsibilities\n- Manage users and devices in Intune\n- Automate onboarding\n"
    "- Keep the help desk queue under a day and document every fix\n\n"
    "Requirements\n- 3+ years administering Microsoft 365\n- PowerShell\n"
)
JOBS = {
    "strong": ("Systems Administrator", "Vellacor", 8),
    "good": ("IT Administrator", "Quillstone", 7),
    "weak": ("Help Desk Lead", "Brambleworks", 4),
}


def _url(name: str) -> str:
    return f"https://www.linkedin.com/jobs/view/40123{abs(hash(name)) % 100000:05d}/"


async def _run(db, user, **mission):
    track = await scout_tracks.create_track(
        db,
        user.id,
        TrackCreate(
            name="IT Admin",
            target_titles=["Systems Administrator", "IT Administrator"],
            key_skills=["Microsoft 365", "Entra ID"],
        ),
    )
    m = await scout_runs.create_mission(
        db,
        user.id,
        MissionCreate(source="linkedin", track_id=track.id, job_count=3, **mission),
    )
    run = await scout_runs.queue_run(db, m.id, user.id)
    await scout_runs.brief(db, user.id, str(run.id))
    await db.commit()
    return run


async def _report(db, user, run, name, *, copy=True):
    title, company, fit = JOBS[name]
    if copy:
        assert await scout_runs.record_capture(
            db,
            user.id,
            CaptureIn(
                url=_url(name),
                title=title,
                company=company,
                location="Springfield, IL",
                description=POSTING + company,
                via="linkedin",
            ),
        )
    out = await scout_runs.report_job(
        db, user.id, str(run.id), _url(name), fit, f"fits {name}", f"gap {name}"
    )
    await db.commit()
    return out


async def _three(db, user, **mission):
    run = await _run(db, user, **mission)
    outs = {name: await _report(db, user, run, name) for name in JOBS}
    return run, outs


async def _findings(client, run):
    body = (await client.get(f"/v1/scout/runs/{run.id}")).json()
    return body, {f["title"]: f for f in body["findings"]}


@pytest.mark.asyncio
class TestPicksWait:
    async def test_good_fits_wait_and_nothing_is_saved(
        self, client: AsyncClient, db_session, test_user
    ):
        run, outs = await _three(db_session, test_user)
        assert [outs[n]["outcome"] for n in JOBS] == ["picked", "picked", "below_bar"]
        # Claude's count is of good fits kept, never "saved".
        assert outs["good"]["kept"] == 2 and "saved" not in outs["good"]
        assert (await db_session.scalars(select(SavedJob))).all() == []

        body, found = await _findings(client, run)
        assert body["needs_review"] is True
        assert body["counts"]["picked"] == 2 and body["counts"]["saved"] == 0
        # The collection doesn't exist until something goes into it.
        assert body["folder"] == {"id": None, "name": "IT Admin"}
        assert all(f["can_save"] for f in found.values())
        assert (await client.get("/v1/attention")).json()["scout_review"] == 2
        assert (await client.get("/v1/collections/")).json()[0]["name"] != "IT Admin"

    async def test_the_run_ends_by_telling_claude_what_to_say(
        self, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        fin = await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        assert fin["counts"]["picked"] == 2
        assert "2 jobs are waiting" in fin["next"] and "Don't say" in fin["next"]

    async def test_a_pick_is_not_brought_back_by_the_next_run(
        self, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        (mission,) = await scout_runs.list_missions(db_session, test_user.id)
        again = await scout_runs.queue_run(db_session, mission.id, test_user.id)
        await scout_runs.brief(db_session, test_user.id, str(again.id))
        rows = [
            {"company": c, "title": t, "url": _url(n)} for n, (t, c, _) in JOBS.items()
        ]
        out = await scout_runs.check_jobs(db_session, test_user.id, str(again.id), rows)
        assert out["open"] == [] and out["skipped"]["seen_before"] == 3

    async def test_the_run_remembers_what_it_looked_at(
        self, client: AsyncClient, db_session, test_user
    ):
        run = await _run(db_session, test_user)
        rows = [
            {"company": "Vellacor", "title": "Systems Administrator", "url": _url("a")},
            {"company": "Tessaline", "title": "Network Engineer", "url": _url("b")},
        ]
        await scout_runs.check_jobs(db_session, test_user.id, str(run.id), rows)
        # The same page again is not more postings.
        await scout_runs.check_jobs(db_session, test_user.id, str(run.id), rows[:1])
        await db_session.commit()
        body = (await client.get(f"/v1/scout/runs/{run.id}")).json()
        assert body["looked_at"] == {
            "rows": 2,
            "pages": 1,
        }  # counts only, no fingerprints

    async def test_seen_before_means_another_search(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        rows = [
            {"company": c, "title": t, "url": _url(n)} for n, (t, c, _) in JOBS.items()
        ]
        # Claude checks a page after reporting its jobs: this search's own.
        await scout_runs.check_jobs(db_session, test_user.id, str(run.id), rows)
        await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        (mission,) = await scout_runs.list_missions(db_session, test_user.id)
        again = await scout_runs.queue_run(db_session, mission.id, test_user.id)
        await scout_runs.brief(db_session, test_user.id, str(again.id))
        await scout_runs.check_jobs(db_session, test_user.id, str(again.id), rows)
        await db_session.commit()
        later = (await client.get(f"/v1/scout/runs/{again.id}")).json()
        assert later["looked_at"] == {"rows": 3, "seen_before": 3, "pages": 1}


@pytest.mark.asyncio
class TestConfirm:
    async def test_saves_what_was_ticked_into_the_searchs_collection(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        _, found = await _findings(client, run)
        ticked = [found["Systems Administrator"]["id"], found["Help Desk Lead"]["id"]]
        r = await client.post(
            f"/v1/scout/runs/{run.id}/confirm", json={"finding_ids": ticked}
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert len(out["saved"]) == 2 and out["already"] == [] and out["failed"] == []
        assert out["folder"]["name"] == "IT Admin" and out["folder"]["id"]

        jobs = (await client.get("/v1/saved-jobs/")).json()
        assert sorted(j["job_listing"]["title"] for j in jobs) == [
            "Help Desk Lead",
            "Systems Administrator",
        ]
        assert {j["collection_id"] for j in jobs} == {out["folder"]["id"]}
        assert {j["origin"] for j in jobs} == {"scout"}
        # Word for word from the page copy, never Claude's text.
        listing = await db_session.scalar(
            select(JobListing).where(JobListing.company == "Vellacor")
        )
        assert listing.description == POSTING + "Vellacor"

        body, found = await _findings(client, run)
        assert body["needs_review"] is False
        assert found["Systems Administrator"]["outcome"] == "saved"
        assert found["Systems Administrator"]["collection_name"] == "IT Admin"
        assert found["Help Desk Lead"]["outcome"] == "saved"
        # The pick left unticked stays, and can still be saved.
        assert found["IT Administrator"]["outcome"] == "skipped"
        assert found["IT Administrator"]["can_save"] is True
        assert (await client.get("/v1/attention")).json()["scout_review"] == 0

    async def test_a_pick_reported_after_the_page_loaded_stays_waiting(
        self, client: AsyncClient, db_session, test_user
    ):
        run = await _run(db_session, test_user)
        await _report(db_session, test_user, run, "strong")
        _, shown = await _findings(client, run)
        # Claude reports another good fit while the user is choosing.
        await _report(db_session, test_user, run, "good")
        out = await client.post(
            f"/v1/scout/runs/{run.id}/confirm",
            json={"finding_ids": [], "shown_ids": [f["id"] for f in shown.values()]},
        )
        assert out.status_code == 200
        body, found = await _findings(client, run)
        assert found["Systems Administrator"]["outcome"] == "skipped"
        assert found["IT Administrator"]["outcome"] == "picked"
        assert body["needs_review"] is True

    async def test_a_run_with_picks_is_listed_however_old(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        run.created_at = datetime(2026, 1, 1, tzinfo=UTC)  # long ago
        (mission,) = await scout_runs.list_missions(db_session, test_user.id)
        for _ in range(3):
            newer = await scout_runs.queue_run(db_session, mission.id, test_user.id)
            await scout_runs.stop_run(db_session, newer.id, test_user.id)
        await db_session.commit()
        listed = await scout_runs.list_runs(db_session, test_user.id, limit=2)
        assert len(listed) == 3 and listed[-1].id == run.id

    async def test_confirming_twice_saves_nothing_new(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        _, found = await _findings(client, run)
        ticked = {"finding_ids": [found["Systems Administrator"]["id"]]}
        await client.post(f"/v1/scout/runs/{run.id}/confirm", json=ticked)
        again = (
            await client.post(f"/v1/scout/runs/{run.id}/confirm", json=ticked)
        ).json()
        assert again["saved"] == [] and len(again["already"]) == 1
        assert len((await client.get("/v1/saved-jobs/")).json()) == 1

    async def test_keeping_none_clears_the_review_and_makes_no_collection(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        out = (await client.post(f"/v1/scout/runs/{run.id}/confirm", json={})).json()
        assert out["saved"] == [] and out["folder"] == {"id": None, "name": "IT Admin"}
        body, found = await _findings(client, run)
        assert body["needs_review"] is False
        assert {f["outcome"] for f in found.values()} == {"skipped", "below_bar"}
        names = [c["name"] for c in (await client.get("/v1/collections/")).json()]
        assert "IT Admin" not in names

    async def test_another_collection_or_a_new_one_for_this_save(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        _, found = await _findings(client, run)
        mine = (
            await client.post("/v1/collections/", json={"name": "Shortlist"})
        ).json()
        r = await client.post(
            f"/v1/scout/runs/{run.id}/confirm",
            json={
                "finding_ids": [found["Systems Administrator"]["id"]],
                "collection_id": mine["id"],
            },
        )
        assert r.json()["folder"] == {"id": mine["id"], "name": "Shortlist"}
        r = await client.post(
            f"/v1/scout/runs/{run.id}/confirm",
            json={
                "finding_ids": [found["IT Administrator"]["id"]],
                "new_collection_name": "  This   week ",
            },
        )
        assert r.json()["folder"]["name"] == "This week"
        by_title = {
            j["job_listing"]["title"]: j["collection_id"]
            for j in (await client.get("/v1/saved-jobs/")).json()
        }
        assert by_title["Systems Administrator"] == mine["id"]
        assert by_title["IT Administrator"] == r.json()["folder"]["id"]

    async def test_bad_destinations_are_refused(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        _, found = await _findings(client, run)
        # The last finding reported: every other pick comes before it.
        one = [found["Help Desk Lead"]["id"]]
        other = await _other_user(db_session)
        theirs = Collection(id=uuid.uuid4(), user_id=other.id, name="Theirs")
        db_session.add(theirs)
        await db_session.commit()
        url = f"/v1/scout/runs/{run.id}/confirm"
        both = {
            "finding_ids": one,
            "collection_id": str(theirs.id),
            "new_collection_name": "Both",
        }
        assert (await client.post(url, json=both)).status_code == 422
        r = await client.post(
            url, json={"finding_ids": one, "collection_id": str(theirs.id)}
        )
        assert r.status_code == 404
        assert (await client.get("/v1/saved-jobs/")).json() == []
        # Still waiting: a refused confirm changes nothing.
        assert (await client.get("/v1/attention")).json()["scout_review"] == 2
        assert (
            await client.post(f"/v1/scout/runs/{uuid.uuid4()}/confirm", json={})
        ).status_code == 404

    async def test_a_job_saved_in_the_meantime_is_not_saved_twice(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        _, found = await _findings(client, run)
        title, company, _ = JOBS["strong"]
        mine = await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://careers.vellacor.example/1",
                "title": title,
                "company": company,
                "location": "Springfield, IL",
            },
        )
        assert mine.status_code == 201
        out = (
            await client.post(
                f"/v1/scout/runs/{run.id}/confirm",
                json={"finding_ids": [found[title]["id"]]},
            )
        ).json()
        assert out["saved"] == [] and len(out["already"]) == 1
        assert out["already"][0]["saved_job_id"] == mine.json()["id"]
        jobs = (await client.get("/v1/saved-jobs/")).json()
        assert len(jobs) == 1 and jobs[0]["origin"] == "manual"
        _, found = await _findings(client, run)
        assert found[title]["outcome"] == "duplicate"

    async def test_a_finding_without_a_page_copy_cannot_be_saved(
        self, client: AsyncClient, db_session, test_user
    ):
        run = await _run(db_session, test_user)
        for _ in range(3):  # the third try without a copy gives up
            await _report(db_session, test_user, run, "strong", copy=False)
        body, found = await _findings(client, run)
        (f,) = found.values()
        assert f["outcome"] == "no_copy" and f["can_save"] is False
        out = (
            await client.post(
                f"/v1/scout/runs/{run.id}/confirm", json={"finding_ids": [f["id"]]}
            )
        ).json()
        assert out["saved"] == [] and len(out["failed"]) == 1
        r = await client.post(f"/v1/scout/findings/{f['id']}/save", json={})
        assert r.status_code == 409


@pytest.mark.asyncio
class TestSaveOneLater:
    async def test_a_skipped_or_below_bar_job_can_be_saved_from_history(
        self, client: AsyncClient, db_session, test_user
    ):
        run, _ = await _three(db_session, test_user)
        await client.post(f"/v1/scout/runs/{run.id}/confirm", json={})
        _, found = await _findings(client, run)
        for title in ("IT Administrator", "Help Desk Lead"):
            r = await client.post(
                f"/v1/scout/findings/{found[title]['id']}/save", json={}
            )
            assert r.status_code == 200, r.text
            assert r.json()["already"] is False
            assert r.json()["folder"]["name"] == "IT Admin"
        again = await client.post(
            f"/v1/scout/findings/{found['Help Desk Lead']['id']}/save", json={}
        )
        assert again.json()["already"] is True
        assert len((await client.get("/v1/saved-jobs/")).json()) == 2

    async def test_someone_elses_finding_is_not_found(
        self, client: AsyncClient, db_session, test_user
    ):
        other = await _other_user(db_session)
        run, _ = await _three(db_session, other)
        finding = await db_session.scalar(select(ScoutFinding))
        r = await client.post(f"/v1/scout/findings/{finding.id}/save", json={})
        assert r.status_code == 404
        assert (await client.get(f"/v1/scout/runs/{run.id}")).status_code == 404
        assert (await client.get("/v1/attention")).json()["scout_review"] == 0


@pytest.mark.asyncio
class TestSaveInto:
    async def test_a_search_names_its_collection(self, client: AsyncClient):
        track = (
            await client.post(
                "/v1/scout/tracks",
                json={"name": "Business Analyst", "target_titles": ["Analyst"]},
            )
        ).json()
        base = {"source": "linkedin", "track_id": track["id"]}
        m = (await client.post("/v1/scout/missions", json=base)).json()
        assert m["collection_id"] is None and m["auto_save"] is False
        assert m["collection_name"] == "Business Analyst"

        mine = (
            await client.post("/v1/collections/", json={"name": "Shortlist"})
        ).json()
        r = await client.patch(
            f"/v1/scout/missions/{m['id']}",
            json={"collection_id": mine["id"], "auto_save": True},
        )
        assert r.json()["collection_name"] == "Shortlist" and r.json()["auto_save"]
        # Deleting the collection doesn't break the search: back to its own.
        assert (await client.delete(f"/v1/collections/{mine['id']}")).status_code == 204
        (after,) = (await client.get("/v1/scout/missions")).json()
        assert after["collection_id"] is None
        assert after["collection_name"] == "Business Analyst"
        r = await client.patch(
            f"/v1/scout/missions/{m['id']}", json={"collection_id": str(uuid.uuid4())}
        )
        assert r.status_code == 404

    async def test_save_without_asking_saves_into_the_chosen_collection(
        self, client: AsyncClient, db_session, test_user
    ):
        mine = (
            await client.post("/v1/collections/", json={"name": "Shortlist"})
        ).json()
        run, outs = await _three(
            db_session, test_user, auto_save=True, collection_id=uuid.UUID(mine["id"])
        )
        assert [outs[n]["outcome"] for n in JOBS] == ["saved", "saved", "below_bar"]
        jobs = (await client.get("/v1/saved-jobs/")).json()
        assert len(jobs) == 2
        assert {j["collection_id"] for j in jobs} == {mine["id"]}
        body, _ = await _findings(client, run)
        assert body["needs_review"] is False
        assert (await client.get("/v1/attention")).json()["scout_review"] == 0
        fin = await scout_runs.finish_run(db_session, test_user.id, str(run.id), "")
        assert "2 jobs were saved" in fin["next"]

    async def test_a_collection_deleted_mid_run_falls_back_to_the_default(
        self, client: AsyncClient, db_session, test_user
    ):
        mine = (
            await client.post("/v1/collections/", json={"name": "Shortlist"})
        ).json()
        run = await _run(db_session, test_user, collection_id=uuid.UUID(mine["id"]))
        await _report(db_session, test_user, run, "strong")
        assert (await client.delete(f"/v1/collections/{mine['id']}")).status_code == 204
        body, found = await _findings(client, run)
        assert body["folder"] == {"id": None, "name": "IT Admin"}
        out = (
            await client.post(
                f"/v1/scout/runs/{run.id}/confirm",
                json={"finding_ids": [f["id"] for f in found.values()]},
            )
        ).json()
        assert out["folder"]["name"] == "IT Admin" and len(out["saved"]) == 1
