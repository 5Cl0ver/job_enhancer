"""Bugs & ideas (spec 032 part A): the owner's one inbox. Priority order, run
problems merged by fingerprint, came back, statuses and history, notes and
links, bulk, delete, merge and split, scrubbing, and every route refused to
anyone but the owner."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.models.bug_report import BugReport, BugReportEvent, BugReportLink
from app.services import bug_reports as svc

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _run():
    return SimpleNamespace(id=uuid.uuid4(), saved_job_id=None)


def _problem(what="Fill timed out on the phone box", kind="fill", **more):
    return {
        "what": what,
        "kind": kind,
        "page": "https://acme.wd1.myworkdayjobs.com/apply/12?token=abc",
        "site": "acme.wd1.myworkdayjobs.com",
        "job_catcher": "0.44.0",
        "playbook": "2026.11.30",
        **more,
    }


async def _add(db, **data):
    report = await svc.create(db, {"title": "A bug", "section": "app", **data})
    await db.commit()
    return report


async def _post(admin_client, **body):
    r = await admin_client.post(
        "/v1/admin/bugs", json={"title": "A bug", "section": "app", **body}
    )
    assert r.status_code == 201, r.text
    return r.json()["report"]


# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #


def test_place_drops_queries_and_ids():
    place = svc.clean_place
    assert place("/jobs/3f2b8c1e-1111-4222-8333-944455556666?x=1#y") == "/jobs/:id"
    assert place("/apply/12345/review") == "/apply/:id/review"
    assert (
        place("https://www.acme.example/careers/job/Senior-Engineer_R0012345?t=abc")
        == "acme.example/careers/job/Senior-Engineer_R0012345"
    )
    assert place("javascript:alert(1)") is None
    assert place("") is None


def test_scrub_keeps_lines_when_asked():
    from app.services.apply_problems import scrub

    text = "Line one\n\n\n\nLine   two\npassword: hunter2"
    assert scrub(text, 100, lines=True) == "Line one\n\nLine two\npassword: [removed]"
    assert scrub(text, 100) == "Line one Line two password: [removed]"
    assert len(scrub("x" * 5000, 2000, lines=True)) == 2000


@pytest.mark.asyncio
async def test_planted_secrets_never_come_back(admin_client):
    secret = (
        "password: hunter2, code 482913, sent to alex.rivera@example.com, "
        "phone (503) 555-0142, card 4111 1111 1111 1111, SSN 123-45-6789, "
        f"key {'aB3' * 12}"
    )
    report = await _post(
        admin_client,
        title=f"Login {secret}"[:140],
        actual=secret,
        expected=secret[:1000],
        steps=[secret[:300], "Press Save"],
        box="Email alex.rivera@example.com",
        place="/settings?token=abcdef",
        context={"device": "phone", "browser": "alex.rivera@example.com"},
    )
    note = await admin_client.post(
        f"/v1/admin/bugs/{report['id']}/notes", json={"text": secret}
    )
    assert note.status_code == 201
    every_read = [
        (await admin_client.get(f"/v1/admin/bugs/{report['id']}")).text,
        (await admin_client.get("/v1/admin/bugs?q=login")).text,
    ]
    for body in every_read:
        for planted in (
            "hunter2",
            "482913",
            "alex.rivera@example.com",
            "555-0142",
            "4111",
            "123-45-6789",
            "aB3aB3aB3",
            "abcdef",
        ):
            assert planted not in body, planted
    detail = (await admin_client.get(f"/v1/admin/bugs/{report['id']}")).json()
    assert detail["steps"][1] == "Press Save"
    assert detail["place"] == "/settings"
    assert detail["context"] == {"device": "phone", "browser": "[removed]"}


# --------------------------------------------------------------------------- #
# Priority, filters, search, counts
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_priority_order(db_session):
    minor = await _add(db_session, title="Minor once", severity="minor")
    blocker = await _add(db_session, title="Blocker five times", severity="blocker")
    blocker.count = 5
    many = await _add(db_session, title="Major many", severity="major")
    many.count = 9
    back = await _add(db_session, title="Major came back", severity="major")
    back.came_back_at = datetime.now(tz=UTC)
    recent = await _add(db_session, title="Major recent", severity="major")
    recent.last_seen = datetime.now(tz=UTC) + timedelta(minutes=5)
    pinned = await _add(db_session, title="Pinned minor", severity="minor")
    pinned.pinned = True
    await db_session.commit()

    out = await svc.list_reports(db_session)
    assert [i["title"] for i in out["items"]] == [
        "Pinned minor",
        "Blocker five times",
        "Major came back",
        "Major many",
        "Major recent",
        "Minor once",
    ]
    assert minor.id  # used


@pytest.mark.asyncio
async def test_tabs_sections_filters_and_search(admin_client, db_session):
    for i in range(3):
        await _add(db_session, title=f"Workday save {i}", section="job_catcher")
    await _add(db_session, title="Scan stuck", section="email", severity="blocker")
    await _add(db_session, title="Mail check", section="email", actual="IMAP said no")
    await _add(db_session, type="idea", title="Dark charts", section="app")
    fixed = await _add(db_session, title="Old fixed", section="app")
    await svc.update_report(db_session, fixed.id, {"status": "fixed"})
    await db_session.commit()

    bugs = (await admin_client.get("/v1/admin/bugs")).json()
    assert bugs["total"] == 5  # open only, by default
    assert bugs["counts"]["bugs_open"] == 5
    assert bugs["counts"]["ideas_open"] == 1
    assert bugs["counts"]["sections"]["job_catcher"] == 3
    assert bugs["counts"]["sections"]["email"] == 2
    assert bugs["counts"]["sections"]["app"] == 0  # the fixed one isn't open

    jc = (await admin_client.get("/v1/admin/bugs?section=job_catcher")).json()
    assert {i["title"] for i in jc["items"]} == {f"Workday save {i}" for i in range(3)}
    # The chips keep counting every section while one is picked.
    assert jc["counts"]["sections"]["email"] == 2

    ideas = (await admin_client.get("/v1/admin/bugs?type=idea")).json()
    assert [(i["title"], i["severity"]) for i in ideas["items"]] == [
        ("Dark charts", None)
    ]
    every = (await admin_client.get("/v1/admin/bugs?status=all")).json()
    assert every["total"] == 6
    only_fixed = (await admin_client.get("/v1/admin/bugs?status=fixed")).json()
    assert [i["title"] for i in only_fixed["items"]] == ["Old fixed"]
    blockers = (await admin_client.get("/v1/admin/bugs?severity=blocker")).json()
    assert [i["title"] for i in blockers["items"]] == ["Scan stuck"]
    # Search looks through the text too, and % is just a character.
    found = (await admin_client.get("/v1/admin/bugs?q=imap")).json()
    assert [i["title"] for i in found["items"]] == ["Mail check"]
    assert (await admin_client.get("/v1/admin/bugs?q=%25")).json()["total"] == 0
    mine = (await admin_client.get("/v1/admin/bugs?source=owner")).json()
    assert mine["total"] == 5
    assert (await admin_client.get("/v1/admin/bugs?status=planned")).status_code == 422
    assert (await admin_client.get("/v1/admin/bugs?section=nope")).status_code == 422


# --------------------------------------------------------------------------- #
# Run problems: merged by fingerprint, came back
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_run_problems_merge_by_fingerprint(db_session):
    run1, run2 = _run(), _run()
    a = await svc.from_run_problem(db_session, run1, _problem())
    b = await svc.from_run_problem(db_session, run2, _problem())
    assert a.id == b.id and b.count == 2 and b.run_id == run2.id
    assert (a.section, a.source, a.place) == (
        "apply",
        "run",
        "acme.wd1.myworkdayjobs.com/apply/:id",
    )
    # Another site, another kind or other words are another report.
    other_site = _problem(site="other.example", page="https://other.example/a")
    assert (await svc.from_run_problem(db_session, run1, other_site)).id != a.id
    jc = await svc.from_run_problem(
        db_session, run1, _problem(kind="job_catcher", what="Said no résumé box")
    )
    assert jc.section == "job_catcher"
    resume = await svc.from_run_problem(
        db_session, run1, _problem(kind="resume", what="Résumé failed")
    )
    assert resume.section == "job_catcher"
    total = await db_session.scalar(select(func.count()).select_from(BugReport))
    assert total == 4

    # 100 of the same: one report counting 100, the newest 20 times kept.
    for _ in range(98):
        await svc.from_run_problem(db_session, run1, _problem())
    await db_session.commit()
    assert a.count == 100
    seen = await db_session.scalar(
        select(func.count())
        .select_from(BugReportEvent)
        .where(BugReportEvent.report_id == a.id, BugReportEvent.kind == "seen")
    )
    assert seen == svc.SEEN_KEPT


@pytest.mark.asyncio
async def test_fixed_report_comes_back(db_session):
    report = await svc.from_run_problem(db_session, _run(), _problem())
    await svc.update_report(
        db_session, report.id, {"status": "fixed", "fixed_in": "Job Catcher 0.45.0"}
    )
    await svc.from_run_problem(db_session, _run(), _problem())
    await db_session.commit()
    assert report.status == "new" and report.came_back_at is not None
    assert report.fixed_in == "Job Catcher 0.45.0" and report.count == 2
    events = (await svc.detail(db_session, report.id))["events"]
    back = next(e for e in events if e["data"].get("came_back"))
    assert back["data"] == {
        "from": "fixed",
        "to": "new",
        "came_back": True,
        "fixed_in": "Job Catcher 0.45.0",
    }
    out = await svc.list_reports(db_session, came_back=True)
    assert [i["id"] for i in out["items"]] == [str(report.id)]

    # Won't fix only counts up.
    await svc.update_report(db_session, report.id, {"status": "wont_fix"})
    await svc.from_run_problem(db_session, _run(), _problem())
    assert (report.status, report.count) == ("wont_fix", 3)


@pytest.mark.asyncio
async def test_a_merged_away_report_feeds_the_one_it_went_into(db_session):
    run_report = await svc.from_run_problem(db_session, _run(), _problem())
    mine = await _add(db_session, title="Phone box times out")
    await svc.merge(db_session, run_report.id, mine.id)
    await svc.from_run_problem(db_session, _run(), _problem())
    assert mine.count == 3 and run_report.count == 1


# --------------------------------------------------------------------------- #
# Statuses, history, edits
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_bug_through_every_status(admin_client):
    report = await _post(admin_client, title="Save does nothing", severity="minor")
    rid = report["id"]
    assert (report["status"], report["severity"], report["source"]) == (
        "new",
        "minor",
        "owner",
    )
    for status in ("confirmed", "working"):
        r = await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"status": status})
        assert r.status_code == 200 and r.json()["status"] == status
    r = await admin_client.patch(
        f"/v1/admin/bugs/{rid}", json={"status": "fixed", "fixed_in": "PR #70"}
    )
    done = r.json()
    assert (done["status"], done["fixed_in"], done["needs_check"]) == (
        "fixed",
        "PR #70",
        False,
    )
    # Gone from the open view.
    assert (await admin_client.get("/v1/admin/bugs")).json()["total"] == 0
    statuses = [
        (e["data"]["from"], e["data"]["to"], e["by"])
        for e in reversed(done["events"])
        if e["kind"] == "status"
    ]
    assert statuses == [
        ("new", "confirmed", "owner"),
        ("confirmed", "working", "owner"),
        ("working", "fixed", "owner"),
    ]
    bad = await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"status": "planned"})
    assert bad.status_code == 422
    nope = await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"status": "maybe"})
    assert nope.status_code == 422


@pytest.mark.asyncio
async def test_claudes_fix_needs_your_check(db_session, admin_client):
    report = await _add(db_session, title="Résumé twice")
    await svc.update_report(
        db_session, report.id, {"status": "fixed", "fixed_in": "PR #71"}, by="claude"
    )
    await db_session.commit()
    checks = (
        await admin_client.get("/v1/admin/bugs?status=all&needs_check=true")
    ).json()
    assert [i["title"] for i in checks["items"]] == ["Résumé twice"]
    r = await admin_client.patch(f"/v1/admin/bugs/{report.id}", json={"checked": True})
    assert r.json()["needs_check"] is False
    last = r.json()["events"][0]
    assert (last["kind"], last["data"]["field"]) == ("edit", "checked")


@pytest.mark.asyncio
async def test_edit_any_field_and_switch_type(admin_client):
    report = await _post(admin_client, title="Typo", actual="Line one\nLine two")
    rid = report["id"]
    assert report["actual"] == "Line one\nLine two"
    r = await admin_client.patch(
        f"/v1/admin/bugs/{rid}",
        json={
            "title": "Typo on Settings",
            "section": "other",
            "severity": "blocker",
            "steps": ["Open Settings", "Look"],
            "pinned": True,
        },
    )
    out = r.json()
    assert (out["title"], out["section"], out["severity"], out["pinned"]) == (
        "Typo on Settings",
        "other",
        "blocker",
        True,
    )
    fields = {e["data"]["field"] for e in out["events"] if e["kind"] == "edit"}
    assert fields == {"title", "section", "severity", "steps", "pinned"}

    idea = (
        await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"type": "idea"})
    ).json()
    assert (idea["type"], idea["status"], idea["severity"]) == ("idea", "new", None)
    assert idea["actual"] == "Line one\nLine two"  # the text is kept
    planned = await admin_client.patch(
        f"/v1/admin/bugs/{rid}", json={"status": "planned"}
    )
    assert planned.json()["status"] == "planned"
    bug = (
        await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"type": "bug"})
    ).json()
    assert (bug["type"], bug["status"], bug["severity"]) == ("bug", "new", "major")
    empty = await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"title": "   "})
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_an_idea_has_no_severity(admin_client):
    idea = await _post(
        admin_client, type="idea", title="Dark charts", severity="blocker"
    )
    assert (idea["type"], idea["status"], idea["severity"]) == ("idea", "new", None)
    attention = (await admin_client.get("/v1/attention")).json()
    assert attention["bugs_new"] == 0  # ideas aren't counted


# --------------------------------------------------------------------------- #
# Notes, links, bulk, delete, merge and split
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_notes_and_links(admin_client):
    a = await _post(admin_client, title="Save fails")
    b = await _post(admin_client, type="idea", title="Retry button")
    r = await admin_client.post(
        f"/v1/admin/bugs/{a['id']}/notes", json={"text": "Seen on a phone"}
    )
    assert r.status_code == 201 and r.json()["data"] == {"text": "Seen on a phone"}
    assert r.json()["by"] == "owner" and r.json()["at"]

    r = await admin_client.post(
        f"/v1/admin/bugs/{b['id']}/links", json={"other_id": a["id"]}
    )
    assert r.status_code == 201 and r.json()["already"] is False
    again = await admin_client.post(
        f"/v1/admin/bugs/{a['id']}/links", json={"other_id": b["id"]}
    )
    assert again.json()["already"] is True
    da = (await admin_client.get(f"/v1/admin/bugs/{a['id']}")).json()
    db_ = (await admin_client.get(f"/v1/admin/bugs/{b['id']}")).json()
    assert [x["title"] for x in da["links"]] == ["Retry button"]
    assert [x["title"] for x in db_["links"]] == ["Save fails"]
    assert da["events"][0]["kind"] == "link"
    assert any(e["kind"] == "note" for e in da["events"])
    self_link = await admin_client.post(
        f"/v1/admin/bugs/{a['id']}/links", json={"other_id": a["id"]}
    )
    assert self_link.status_code == 400

    r = await admin_client.delete(f"/v1/admin/bugs/{a['id']}/links/{b['id']}")
    assert r.status_code == 204
    assert (await admin_client.get(f"/v1/admin/bugs/{b['id']}")).json()["links"] == []
    gone = await admin_client.delete(f"/v1/admin/bugs/{a['id']}/links/{b['id']}")
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_bulk_change(admin_client):
    ids = [(await _post(admin_client, title=f"Junk {i}"))["id"] for i in range(3)]
    idea = (await _post(admin_client, type="idea", title="Idea"))["id"]
    r = await admin_client.post(
        "/v1/admin/bugs/bulk", json={"ids": [*ids, idea], "status": "wont_fix"}
    )
    assert r.json() == {"changed": 3}  # an idea can't be "won't fix"
    for rid in ids:
        d = (await admin_client.get(f"/v1/admin/bugs/{rid}")).json()
        assert d["status"] == "wont_fix"
        assert d["events"][0]["data"] == {"from": "new", "to": "wont_fix"}
    r = await admin_client.post(
        "/v1/admin/bugs/bulk", json={"ids": [*ids, idea], "section": "scout"}
    )
    assert r.json() == {"changed": 4}
    bad = await admin_client.post(
        "/v1/admin/bugs/bulk", json={"ids": ids, "section": "nope"}
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_delete_for_good(admin_client, db_session):
    a = await _post(admin_client, title="Test junk")
    b = await _post(admin_client, title="Real one")
    await admin_client.post(f"/v1/admin/bugs/{a['id']}/notes", json={"text": "x"})
    await admin_client.post(
        f"/v1/admin/bugs/{a['id']}/links", json={"other_id": b["id"]}
    )
    r = await admin_client.delete(f"/v1/admin/bugs/{a['id']}")
    assert r.status_code == 204
    assert (await admin_client.get(f"/v1/admin/bugs/{a['id']}")).status_code == 404
    assert (await admin_client.delete(f"/v1/admin/bugs/{a['id']}")).status_code == 404
    rid = uuid.UUID(a["id"])
    events = await db_session.scalar(
        select(func.count())
        .select_from(BugReportEvent)
        .where(BugReportEvent.report_id == rid)
    )
    links = await db_session.scalar(select(func.count()).select_from(BugReportLink))
    assert (events, links) == (0, 0)
    assert (await admin_client.get(f"/v1/admin/bugs/{b['id']}")).json()["links"] == []


@pytest.mark.asyncio
async def test_merge_and_split(admin_client, db_session):
    a = await _post(admin_client, title="Phone put in Phone Extension")
    b = await _post(admin_client, title="Phone in extension box")
    await db_session.execute(
        BugReport.__table__.update()
        .where(BugReport.id == uuid.UUID(b["id"]))
        .values(count=2)
    )
    await db_session.commit()
    r = await admin_client.post(
        f"/v1/admin/bugs/{b['id']}/merge", json={"into_id": a["id"]}
    )
    assert r.status_code == 200, r.text
    merged = r.json()
    assert merged["id"] == a["id"] and merged["count"] == 3
    assert (await admin_client.get(f"/v1/admin/bugs/{b['id']}")).status_code == 404
    titles = [
        i["title"] for i in (await admin_client.get("/v1/admin/bugs")).json()["items"]
    ]
    assert titles == ["Phone put in Phone Extension"]
    for bad in (
        {"into_id": b["id"]},  # merged away already
    ):
        assert (
            await admin_client.post(f"/v1/admin/bugs/{a['id']}/merge", json=bad)
        ).status_code == 400
    assert (
        await admin_client.post(
            f"/v1/admin/bugs/{a['id']}/merge", json={"into_id": a["id"]}
        )
    ).status_code == 400

    ev = next(e for e in merged["events"] if e["kind"] == "merge")
    assert ev["data"]["title"] == "Phone in extension box"
    r = await admin_client.post(f"/v1/admin/bugs/{a['id']}/split/{ev['id']}")
    assert r.status_code == 200, r.text
    assert (r.json()["id"], r.json()["count"]) == (b["id"], 2)
    back = (await admin_client.get(f"/v1/admin/bugs/{a['id']}")).json()
    assert back["count"] == 1
    assert back["events"][0]["kind"] == "split"
    again = await admin_client.post(f"/v1/admin/bugs/{a['id']}/split/{ev['id']}")
    assert again.status_code == 400
    missing = await admin_client.post(f"/v1/admin/bugs/{a['id']}/split/{uuid.uuid4()}")
    assert missing.status_code == 404


# --------------------------------------------------------------------------- #
# The owner only
# --------------------------------------------------------------------------- #

RID, OTHER, EV = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
EVERY_ROUTE = [
    ("get", "/v1/admin/bugs", None),
    ("post", "/v1/admin/bugs", {"title": "x", "section": "app"}),
    ("post", "/v1/admin/bugs/bulk", {"ids": [str(RID)], "status": "fixed"}),
    ("get", f"/v1/admin/bugs/{RID}", None),
    ("patch", f"/v1/admin/bugs/{RID}", {"status": "fixed"}),
    ("delete", f"/v1/admin/bugs/{RID}", None),
    ("post", f"/v1/admin/bugs/{RID}/notes", {"text": "x"}),
    ("post", f"/v1/admin/bugs/{RID}/links", {"other_id": str(OTHER)}),
    ("delete", f"/v1/admin/bugs/{RID}/links/{OTHER}", None),
    ("post", f"/v1/admin/bugs/{RID}/merge", {"into_id": str(OTHER)}),
    ("post", f"/v1/admin/bugs/{RID}/split/{EV}", None),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "url", "body"), EVERY_ROUTE)
async def test_everyone_else_is_refused(client, method, url, body):
    kwargs = {"json": body} if body is not None else {}
    r = await client.request(method.upper(), url, **kwargs)
    assert r.status_code == 403, (method, url, r.text)


@pytest.mark.asyncio
async def test_signed_out_is_refused(anon_client):
    assert (await anon_client.get("/v1/admin/bugs")).status_code in (401, 403)


async def _attention_seeds(db_session):
    await _add(db_session, title="New one")
    await _add(db_session, title="Another new")
    working = await _add(db_session, title="Being fixed")
    await svc.update_report(db_session, working.id, {"status": "working"})
    await _add(db_session, type="idea", title="An idea")
    await db_session.commit()


@pytest.mark.asyncio
async def test_attention_counts_new_bugs_for_the_owner(admin_client, db_session):
    await _attention_seeds(db_session)
    assert (await admin_client.get("/v1/attention")).json()["bugs_new"] == 2


@pytest.mark.asyncio
async def test_attention_counts_nothing_for_anyone_else(client, db_session):
    await _attention_seeds(db_session)
    assert (await client.get("/v1/attention")).json()["bugs_new"] == 0


@pytest.mark.asyncio
async def test_missing_report_is_404(admin_client):
    rid = uuid.uuid4()
    assert (await admin_client.get(f"/v1/admin/bugs/{rid}")).status_code == 404
    r = await admin_client.patch(f"/v1/admin/bugs/{rid}", json={"status": "fixed"})
    assert r.status_code == 404
    r = await admin_client.post(f"/v1/admin/bugs/{rid}/notes", json={"text": "x"})
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Review fixes: line breaks, cuts, tokens, merges, deletes, races, links
# --------------------------------------------------------------------------- #


def test_secrets_split_across_line_breaks_are_removed():
    from app.services.apply_problems import scrub

    for planted, gone in (
        ("password:\nhunter2", "hunter2"),
        ("my password is\nhunter2 again", "hunter2"),
        ("the code\n482913 came by text", "482913"),
        ("call 503-555-\n0142 now", "0142"),
        ("card 4111-\n1111 1111 1111 was typed", "1111"),
        ("SSN 123-\n45-6789", "6789"),
    ):
        out = scrub(f"Line one\n{planted}", 1000, lines=True)
        assert gone not in out, planted
        assert out.startswith("Line one\n")


def test_secrets_are_removed_before_the_cut():
    from app.services.apply_problems import scrub

    near_end = "x" * 285 + " alex.rivera@example.com"
    assert "alex" not in scrub(near_end, 300)
    card = "y" * 290 + " 4111 1111 1111 1111"
    assert "4111" not in scrub(card, 300)
    assert len(scrub(near_end, 300)) <= 300


def test_place_hides_token_segments_but_keeps_job_slugs():
    place = svc.clean_place
    assert place("/reset/AbC-123_xyzQ9fK2LmN0pR/done") == "/reset/:id/done"
    assert place("https://acme.example/s/9fK2LmN0pRaB3cD4/apply") == (
        "acme.example/s/:id/apply"
    )
    slug = "https://acme.example/careers/job/Senior-Software-Engineer_R0012345"
    assert place(slug) == "acme.example/careers/job/Senior-Software-Engineer_R0012345"
    long_place = "/" + "a" * 290 + "?x=1 alex.rivera@example.com"
    assert "alex" not in (place(long_place) or "")


@pytest.mark.asyncio
async def test_notes_and_text_with_line_break_secrets(admin_client):
    report = await _post(
        admin_client, title="Sign in fails", actual="It said password:\nhunter2"
    )
    assert "hunter2" not in report["actual"]
    r = await admin_client.post(
        f"/v1/admin/bugs/{report['id']}/notes", json={"text": "code\n482913"}
    )
    assert "482913" not in r.text


@pytest.mark.asyncio
async def test_split_after_two_merges_works_the_dates_out(db_session):
    now = datetime.now(tz=UTC)
    a = await _add(db_session, title="A")
    b = await _add(db_session, title="B")
    c = await _add(db_session, title="C")
    a.first_seen, a.last_seen = now - timedelta(days=1), now - timedelta(hours=5)
    b.first_seen, b.last_seen = now - timedelta(days=10), now - timedelta(hours=1)
    b.came_back_at, b.count = now - timedelta(hours=1), 3
    c.first_seen, c.last_seen = now - timedelta(days=5), now - timedelta(hours=3)
    c.count = 2
    await db_session.commit()

    await svc.merge(db_session, b.id, a.id)
    await svc.merge(db_session, c.id, a.id)
    await db_session.commit()
    assert a.count == 6
    assert svc._aware(a.first_seen) == b.first_seen
    assert a.came_back_at is not None

    merge_b = next(
        e
        for e in (await svc.detail(db_session, a.id))["events"]
        if e["kind"] == "merge" and e["data"]["title"] == "B"
    )
    await svc.split(db_session, a.id, uuid.UUID(merge_b["id"]))
    await db_session.commit()
    # C is still merged in: its dates count, B's don't.
    assert a.count == 3
    assert svc._aware(a.first_seen) == c.first_seen
    assert svc._aware(a.last_seen) == c.last_seen
    assert a.came_back_at is None  # it only came with B

    merge_c = next(
        e
        for e in (await svc.detail(db_session, a.id))["events"]
        if e["kind"] == "merge" and e["data"]["title"] == "C"
    )
    await svc.split(db_session, a.id, uuid.UUID(merge_c["id"]))
    await db_session.commit()
    assert a.count == 1
    assert svc._aware(a.first_seen) == now - timedelta(days=1)
    assert svc._aware(a.last_seen) == now - timedelta(hours=5)


@pytest.mark.asyncio
async def test_a_merged_away_report_cant_be_deleted(admin_client):
    a = await _post(admin_client, title="Kept")
    b = await _post(admin_client, title="Merged away")
    r = await admin_client.post(
        f"/v1/admin/bugs/{b['id']}/merge", json={"into_id": a["id"]}
    )
    assert r.json()["count"] == 2
    assert (await admin_client.delete(f"/v1/admin/bugs/{b['id']}")).status_code == 404
    kept = (await admin_client.get(f"/v1/admin/bugs/{a['id']}")).json()
    assert kept["count"] == 2
    ev = next(e for e in kept["events"] if e["kind"] == "merge")
    split = await admin_client.post(f"/v1/admin/bugs/{a['id']}/split/{ev['id']}")
    assert split.status_code == 200


@pytest.mark.asyncio
async def test_the_same_problem_arriving_twice_at_once_is_one_report(
    db_session, monkeypatch
):
    first = await svc.from_run_problem(db_session, _run(), _problem())
    await db_session.commit()
    real = svc._by_fingerprint
    calls = {"n": 0}

    async def missed_once(db, fp):
        # The other call's report isn't seen yet: this one tries to add it too.
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, fp)

    monkeypatch.setattr(svc, "_by_fingerprint", missed_once)
    again = await svc.from_run_problem(db_session, _run(), _problem())
    await db_session.commit()
    assert again.id == first.id and again.count == 2
    total = await db_session.scalar(select(func.count()).select_from(BugReport))
    assert total == 1


@pytest.mark.asyncio
async def test_job_and_run_link_only_when_they_are_the_owners(
    admin_client, db_session, admin_user, test_user
):
    from app.models.job_listing import JobListing
    from app.models.saved_job import SavedJob

    async def job_of(user):
        listing = JobListing(
            id=uuid.uuid4(),
            external_id=uuid.uuid4().hex,
            source="test",
            title="IT Engineer",
            company="Northwind Labs",
            location="Springfield, IL",
            apply_url="https://northwind.example/jobs/1",
            content_hash=uuid.uuid4().hex,
            company_normalized="northwind labs",
            title_normalized="it engineer",
        )
        db_session.add(listing)
        await db_session.flush()
        saved = SavedJob(id=uuid.uuid4(), user_id=user.id, job_listing_id=listing.id)
        db_session.add(saved)
        await db_session.flush()
        return saved

    mine, theirs = await job_of(admin_user), await job_of(test_user)
    a = await _add(db_session, title="Mine")
    b = await _add(db_session, title="Theirs")
    a.job_id, b.job_id = mine.id, theirs.id
    await db_session.commit()
    da = (await admin_client.get(f"/v1/admin/bugs/{a.id}")).json()
    db_ = (await admin_client.get(f"/v1/admin/bugs/{b.id}")).json()
    assert da["job"]["own"] is True
    assert db_["job"]["own"] is False
    assert db_["job"]["title"] == "IT Engineer"


def test_scrub_stays_fast_on_huge_input():
    """A pasted page can't stall the server: the text is bounded before the
    patterns run, and the email pattern can't retry quadratically."""
    import time

    from app.services.apply_problems import scrub

    for blob in ("a" * 200_000, "aB3" * 70_000, ("word " * 40_000)):
        start = time.perf_counter()
        out = scrub(blob, 2000, lines=True)
        assert time.perf_counter() - start < 0.2
        assert len(out) <= 2000
    # A secret right at the cut is still caught whole.
    text = "x " * 995 + "reach me at alex.rivera@example.com please"
    assert "example.com" not in scrub(text, 2000)
