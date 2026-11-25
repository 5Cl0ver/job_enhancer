"""Apply with Claude routes (spec 022): the app's, Job Catcher's, the things
told to Claude, and the master / made-for-a-job résumés."""

import uuid

import pytest
from sqlalchemy import select

from app.models.apply import ApplyPhoto, ProfileFact
from app.models.generated_document import GeneratedDocument
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.services import apply_runs as svc
from app.services import master_profile
from app.services.users import create_user

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100


async def _job(client) -> str:
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/123",
            "title": "IT Engineer",
            "company": "Acme",
            "description": "Intune and Okta. " * 50,
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _started(client, db_session, test_user) -> tuple[str, str]:
    job_id = await _job(client)
    r = await client.post("/v1/apply/runs", json={"saved_job_id": job_id})
    assert r.status_code == 201, r.text
    run_id = r.json()["id"]
    await svc.brief(db_session, test_user, run_id)
    await db_session.commit()
    return job_id, run_id


@pytest.mark.asyncio
async def test_start_one_at_a_time(client):
    job_id = await _job(client)
    r = await client.post("/v1/apply/runs", json={"saved_job_id": job_id})
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "waiting"
    assert body["job"]["company"] == "Acme"
    assert body["apply_url"] == "https://jobs.lever.co/acme/123"

    again = await client.post("/v1/apply/runs", json={"saved_job_id": job_id})
    assert again.status_code == 409
    assert again.json()["open_run_id"] == body["id"]

    opened = (await client.get("/v1/apply/runs/open")).json()
    assert opened["id"] == body["id"]
    listed = (await client.get(f"/v1/apply/runs?saved_job_id={job_id}")).json()
    assert [r["id"] for r in listed] == [body["id"]]

    stopped = (await client.post(f"/v1/apply/runs/{body['id']}/stop")).json()
    assert stopped["status"] == "stopped"
    assert (await client.get("/v1/apply/runs/open")).json() is None


@pytest.mark.asyncio
async def test_someone_elses_job_or_run_is_not_found(client, db_session):
    other = await create_user(db_session, email="other@test.dev", name="Other")
    await db_session.commit()
    r = await client.post("/v1/apply/runs", json={"saved_job_id": str(uuid.uuid4())})
    assert r.status_code == 404
    assert (await client.get(f"/v1/apply/runs/{uuid.uuid4()}")).status_code == 404
    assert other.id  # a second account exists; nothing of theirs is reachable


@pytest.mark.asyncio
async def test_answer_decide_and_the_review(client, db_session, test_user):
    _, run_id = await _started(client, db_session, test_user)
    await svc.ask_questions(
        db_session, test_user, run_id, [{"question": "Used Okta?", "why": "Okta"}]
    )
    await db_session.commit()
    run = (await client.get(f"/v1/apply/runs/{run_id}")).json()
    assert run["status"] == "questions" and run["questions_open"] == 1
    qid = run["questions"][0]["id"]

    r = await client.post(
        f"/v1/apply/runs/{run_id}/answers",
        json={"answers": [{"id": qid, "answer": "Yes, SSO"}], "done": True},
    )
    assert r.status_code == 200
    assert r.json()["answers_done"] is True
    facts = (await client.get("/v1/profile-facts")).json()
    assert [(f["question"], f["answer"]) for f in facts] == [("Used Okta?", "Yes, SSO")]

    # Not at the review yet: no decision.
    no = await client.post(
        f"/v1/apply/runs/{run_id}/decision", json={"decision": "submit"}
    )
    assert no.status_code == 400

    await svc.wait_for_you(db_session, test_user, run_id, seconds=0)  # → writing
    await svc.page_done(
        db_session,
        test_user,
        run_id,
        "https://jobs.lever.co/acme/123/apply",
        "Apply",
        [],
        last=True,
    )
    await db_session.commit()
    fix = await client.post(
        f"/v1/apply/runs/{run_id}/decision", json={"decision": "fix"}
    )
    assert fix.status_code == 400  # a fix needs a note
    ok = await client.post(
        f"/v1/apply/runs/{run_id}/decision", json={"decision": "self"}
    )
    assert ok.json()["review"]["decision"] == "self"
    sent = await client.post(f"/v1/apply/runs/{run_id}/sent")
    assert sent.json()["status"] == "sent"


@pytest.mark.asyncio
async def test_job_catcher_routes(client, db_session, test_user):
    _, run_id = await _started(client, db_session, test_user)
    _, page, req = await svc.page_done(
        db_session, test_user, run_id, "https://jobs.lever.co/acme/123/apply", "One", []
    )
    await db_session.commit()

    state = (await client.get("/v1/apply/active")).json()
    assert state["run_id"] == run_id and state["guard"] is True
    assert state["hosts"] == ["jobs.lever.co"]
    assert state["requests"][0]["kind"] == "photo"

    rid = state["requests"][0]["id"]
    assert (await client.post(f"/v1/apply/requests/{rid}/claim")).status_code == 200
    assert (await client.post(f"/v1/apply/requests/{rid}/claim")).status_code == 409

    bad = await client.post(
        f"/v1/apply/requests/{rid}/photo?part=0",
        content=JPEG,
        headers={"content-type": "image/png"},
    )
    assert bad.status_code == 415
    big = await client.post(
        f"/v1/apply/requests/{rid}/photo?part=0",
        content=JPEG + b"\x00" * 400_001,
        headers={"content-type": "image/jpeg"},
    )
    assert big.status_code == 413
    up = await client.post(
        f"/v1/apply/requests/{rid}/photo?part=0",
        content=JPEG,
        headers={"content-type": "image/jpeg"},
    )
    assert up.status_code == 201
    photo_id = up.json()["id"]

    done = await client.post(
        f"/v1/apply/requests/{rid}/result",
        json={"ok": True, "answers": [{"q": "Name", "a": "Sam"}]},
    )
    assert done.json()["status"] == "done"
    got = await client.get(f"/v1/apply/photos/{photo_id}")
    assert got.status_code == 200 and got.content == JPEG
    assert got.headers["cache-control"] == "private, no-store"

    ev = await client.post(
        f"/v1/apply/runs/{run_id}/event",
        json={"kind": "blocked_submit", "url": "https://jobs.lever.co/acme/123/apply"},
    )
    assert ev.status_code == 200


@pytest.mark.asyncio
async def test_photos_are_only_their_owners(client, db_session, test_user):
    other = await create_user(db_session, email="o@test.dev", name="O")
    _, run_id = await _started(client, db_session, test_user)
    photo = ApplyPhoto(
        run_id=uuid.UUID(run_id), user_id=other.id, page_n=1, part=0, data=JPEG, size=4
    )
    db_session.add(photo)
    await db_session.commit()
    assert (await client.get(f"/v1/apply/photos/{photo.id}")).status_code == 404


@pytest.mark.asyncio
async def test_facts_edit_and_delete(client, db_session, test_user):
    fact = ProfileFact(user_id=test_user.id, question="Used Jamf?", answer="No")
    db_session.add(fact)
    await db_session.commit()
    r = await client.patch(
        f"/v1/profile-facts/{fact.id}", json={"answer": "Yes, 2 years"}
    )
    assert r.json()["answer"] == "Yes, 2 years"
    text = await master_profile.profile_text(db_session, test_user)
    assert '"Used Jamf?" -> Yes, 2 years' in text
    assert (await client.delete(f"/v1/profile-facts/{fact.id}")).status_code == 204
    assert (await client.get("/v1/profile-facts")).json() == []
    assert (await client.delete(f"/v1/profile-facts/{fact.id}")).status_code == 404


def _resume(user, name, **kw) -> Resume:
    return Resume(
        user_id=user.id,
        filename=name,
        mime_type="application/pdf",
        file_size_bytes=1,
        extracted_text=f"text of {name}",
        **kw,
    )


@pytest.mark.asyncio
async def test_master_resume_wins_and_made_for_a_job_can_go(
    client, db_session, test_user
):
    usual = _resume(test_user, "usual.pdf", is_active=True)
    big = _resume(test_user, "big.pdf", is_active=False)
    db_session.add_all([usual, big])
    await db_session.commit()
    assert "text of usual.pdf" in await master_profile.profile_text(
        db_session, test_user
    )

    r = await client.put(f"/v1/ai/resumes/{big.id}/master")
    assert r.status_code == 200 and r.json()["is_master"] is True
    text = await master_profile.profile_text(db_session, test_user)
    assert "text of big.pdf" in text and "usual.pdf" not in text

    # Neither the usual nor the master can be deleted.
    assert (await client.delete(f"/v1/ai/resumes/{big.id}")).status_code == 400
    assert (await client.delete(f"/v1/ai/resumes/{usual.id}")).status_code == 400

    job_id = await _job(client)
    doc = GeneratedDocument(user_id=test_user.id, document_type="resume", content="x")
    db_session.add(doc)
    await db_session.flush()
    made = _resume(test_user, "made.pdf", is_active=False, document_id=doc.id)
    db_session.add(made)
    await db_session.flush()
    sj = await db_session.get(SavedJob, uuid.UUID(job_id))
    sj.resume_id = made.id
    await db_session.commit()

    assert (await client.put(f"/v1/ai/resumes/{made.id}/master")).status_code == 400
    listed = {r["filename"]: r for r in (await client.get("/v1/ai/resumes")).json()}
    assert listed["made.pdf"]["document_id"] == str(doc.id)
    assert (await client.delete(f"/v1/ai/resumes/{made.id}")).status_code == 204
    await db_session.refresh(sj)
    assert sj.resume_id is None
    assert await db_session.scalar(select(Resume).where(Resume.id == made.id)) is None


@pytest.mark.asyncio
async def test_editing_the_document_remakes_the_pdf(client, db_session, test_user):
    from app.services.apply_resume import plain

    doc = GeneratedDocument(user_id=test_user.id, document_type="resume", content="# A")
    db_session.add(doc)
    await db_session.flush()
    made = _resume(test_user, "made.pdf", is_active=False, document_id=doc.id)
    made.file_data = b"old"
    db_session.add(made)
    await db_session.commit()
    new = "# Sam Rivera\nme@x.com\n\n## SKILLS\n**IT:** Intune\n\n## WORK\n- Did things"
    r = await client.patch(f"/v1/ai/documents/{doc.id}", json={"edited_content": new})
    assert r.status_code == 200
    await db_session.refresh(made)
    assert made.file_data.startswith(b"%PDF")
    assert made.extracted_text == plain(new)
