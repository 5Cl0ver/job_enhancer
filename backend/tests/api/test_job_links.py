"""Tie an email to the saved job it's really about (spec 013).

Invented agency, people and jobs only.
"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.models.detected_event import DetectedEvent
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services import email_sync
from app.services.email_match import MATCHED, company_initials, match_job
from app.services.email_scan import EmailMessage
from app.services.job_links import likely_job, rank_jobs
from tests.api.test_email import _as_sync, _create_saved_job

AGENCY = "Department of Harbor Services"
TITLE = "Workflow Platform Engineer"
INTERVIEW = "We'd like to schedule an interview. What's your availability next week?"


@pytest.fixture
def enc_key(monkeypatch):
    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


async def _stage(db, user, name):
    return await db.scalar(
        select(PipelineStage).where(
            PipelineStage.user_id == user.id, PipelineStage.name == name
        )
    )


async def _applied_job(db, user, company=AGENCY, title=TITLE):
    sj = await _create_saved_job(db, user, company, title)
    sj.pipeline_stage_id = (await _stage(db, user, "Applied")).id
    sj.applied_at = datetime.now(tz=UTC)
    await db.flush()
    return sj


async def _scan(client, monkeypatch, *messages):
    await client.post(
        "/v1/email/connect",
        json={"email_address": "me@yahoo.com", "app_password": "app-pass"},
    )

    async def fake_fetch(*args, **kwargs):
        return list(messages)

    monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
    return (await client.post("/v1/email/scan")).json()


def _mail(uid, sender, subject="Next phase of our recruitment process", body=INTERVIEW):
    return EmailMessage(uid=uid, from_addr=sender, subject=subject, body=body)


class TestInitials:
    def test_three_word_names_have_initials(self):
        assert company_initials(AGENCY) == "dhs"
        assert company_initials("Vellacor") == ""
        assert company_initials("Copper Kettle") == ""  # two letters match too much

    def test_sender_domain_initials_match_the_only_job_there(self):
        jobs = [
            {"id": 1, "company": AGENCY, "title": TITLE},
            {"id": 2, "company": "Vellacor", "title": "Data Engineer"},
        ]
        m = match_job(
            jobs,
            subject="Next phase of our recruitment process",
            from_addr="Rowan Pike <rowan.pike@dhs.harbor.example.gov>",
            text=INTERVIEW,
        )
        assert m.status == MATCHED and m.job["id"] == 1

    def test_capital_initials_with_the_title_match(self):
        jobs = [{"id": 1, "company": AGENCY, "title": TITLE}]
        m = match_job(
            jobs,
            subject="DHS: Workflow Platform Engineer next steps",
            from_addr="Rowan Pike <rowan.pike@gmail.com>",
            text=INTERVIEW,
        )
        assert m.status == MATCHED and m.job["id"] == 1

    def test_lowercase_initials_never_count(self):
        jobs = [{"id": 1, "company": AGENCY, "title": TITLE}]
        m = match_job(
            jobs,
            subject="dhs next steps",
            from_addr="Rowan Pike <rowan.pike@gmail.com>",
            text=INTERVIEW,
        )
        assert m.status != MATCHED


class TestRank:
    def test_evidence_first_then_newest_application(self):
        old = datetime(2026, 1, 1, tzinfo=UTC)
        new = datetime(2026, 11, 1, tzinfo=UTC)
        jobs = [
            {
                "id": 1,
                "company": "Vellacor",
                "title": "Data Engineer",
                "applied_at": new,
            },
            {"id": 2, "company": AGENCY, "title": TITLE, "applied_at": old},
            {"id": 3, "company": "Tidelock", "title": "Analyst", "applied_at": None},
        ]
        ranked = rank_jobs(
            jobs,
            subjects=["Next phase of our recruitment process"],
            senders=["Rowan Pike <rowan.pike@dhs.harbor.example.gov>"],
        )
        assert [j["id"] for j in ranked] == [2, 1, 3]
        assert [j["likely"] for j in ranked] == [True, False, False]

    def test_title_in_subject_or_read_name(self):
        jobs = [
            {"id": 1, "company": "Vellacor", "title": "Data Engineer"},
            {"id": 2, "company": AGENCY, "title": TITLE},
        ]
        by_subject = rank_jobs(jobs, subjects=[f"Re: {TITLE} interview"])
        assert by_subject[0]["id"] == 2 and by_subject[0]["likely"]
        by_name = rank_jobs(jobs, title="Data Engineer")
        assert by_name[0]["id"] == 1 and by_name[0]["likely"]
        # One shared word is not the title.
        loose = rank_jobs(jobs, subjects=["The engineer team says hi"])
        assert not any(j["likely"] for j in loose)

    def test_likely_job_is_one_clear_guess(self):
        jobs = [
            {"id": 1, "company": "Vellacor", "title": "Data Engineer"},
            {"id": 2, "company": AGENCY, "title": TITLE},
        ]

        def ev(company="", title="", subject="Next steps", sender="a@gmail.com"):
            return SimpleNamespace(
                job_company=company, job_title=title, subject=subject, from_addr=sender
            )

        assert likely_job(ev(sender="Rowan <r@dhs.example.gov>"), jobs)["id"] == 2
        assert likely_job(ev(company="Vellacor, Inc."), jobs)["id"] == 1
        assert likely_job(ev(), jobs) is None  # nothing points anywhere
        twins = [*jobs, {"id": 3, "company": "Vellacor", "title": "Analyst"}]
        assert likely_job(ev(company="Vellacor"), twins) is None  # a tie is no guess


@pytest.mark.asyncio
class TestAgencyEmailMatches:
    async def test_interview_from_the_agency_domain_lands_on_the_job(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj = await _applied_job(db_session, test_user)
        body = await _scan(
            client, monkeypatch, _mail("1", "Rowan Pike <rowan.pike@dhs.example.gov>")
        )
        assert body["unsaved"] == 0
        events = (await client.get("/v1/email/events")).json()
        assert [e["saved_job_id"] for e in events] == [str(sj.id)]


@pytest.mark.asyncio
class TestLinkUnsavedUpdate:
    """'It's one of my jobs' on an update the scan couldn't place."""

    async def _unsaved(self, client, db_session, test_user, monkeypatch):
        sj = await _applied_job(db_session, test_user)
        await _create_saved_job(db_session, test_user, "Vellacor", "Data Engineer")
        body = await _scan(
            client, monkeypatch, _mail("1", "Rowan Pike <rowan.pike@gmail.com>")
        )
        assert body["unsaved"] == 1
        (ev,) = [
            e
            for e in (await client.get("/v1/email/events")).json()
            if e["category"] == "unsaved"
        ]
        return sj, ev

    async def test_link_moves_the_card_and_undo_puts_it_back(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, ev = await self._unsaved(client, db_session, test_user, monkeypatch)
        assert ev["likely_job"] is None  # the email names nothing
        opts = (await client.get(f"/v1/email/events/{ev['id']}/link-options")).json()
        assert str(sj.id) in [o["saved_job_id"] for o in opts]
        assert {"title", "company", "stage", "likely"} <= set(opts[0])

        r = await client.post(
            f"/v1/email/events/{ev['id']}/link", json={"saved_job_id": str(sj.id)}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "applied" and r.json()["saved_job_id"] == str(
            sj.id
        )
        await db_session.refresh(sj)
        assert (
            sj.pipeline_stage_id
            == (await _stage(db_session, test_user, "Interview")).id
        )
        # No new job was made.
        count = len(
            (
                await db_session.scalars(
                    select(SavedJob).where(SavedJob.user_id == test_user.id)
                )
            ).all()
        )
        assert count == 2
        # Handled: can't be linked or added again.
        again = await client.post(
            f"/v1/email/events/{ev['id']}/link", json={"saved_job_id": str(sj.id)}
        )
        assert again.status_code == 409

        assert (
            await client.post(f"/v1/email/events/{ev['id']}/undo")
        ).status_code == 200
        await db_session.refresh(sj)
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Applied")).id
        )

    async def test_the_sender_is_remembered(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, ev = await self._unsaved(client, db_session, test_user, monkeypatch)
        await client.post(
            f"/v1/email/events/{ev['id']}/link", json={"saved_job_id": str(sj.id)}
        )
        body = await _scan(
            client,
            monkeypatch,
            _mail(
                "2",
                "Rowan Pike <rowan.pike@gmail.com>",
                subject="Your offer",
                body="We're pleased to offer you the position.",
            ),
        )
        assert body["unsaved"] == 0
        rows = (
            await db_session.scalars(
                select(DetectedEvent).where(DetectedEvent.message_uid == "2")
            )
        ).all()
        assert [r.saved_job_id for r in rows] == [sj.id]

    async def test_only_own_jobs_and_unsaved_updates(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        _, ev = await self._unsaved(client, db_session, test_user, monkeypatch)
        r = await client.post(
            f"/v1/email/events/{ev['id']}/link",
            json={"saved_job_id": str(uuid.uuid4())},
        )
        assert r.status_code == 404
        r = await client.get(f"/v1/email/events/{uuid.uuid4()}/link-options")
        assert r.status_code == 404


@pytest.mark.asyncio
class TestSameJobAs:
    """'Same job as…' on a job made from an email."""

    async def _pair(self, client, db_session, test_user, monkeypatch):
        sj = await _applied_job(db_session, test_user)
        await _scan(
            client, monkeypatch, _mail("1", "Rowan Pike <rowan.pike@gmail.com>")
        )
        (ev,) = [
            e
            for e in (await client.get("/v1/email/events")).json()
            if e["category"] == "unsaved"
        ]
        made = await client.post(
            f"/v1/email/events/{ev['id']}/track",
            json={"company": "Rowan Pike", "title": "Next phase of our process"},
        )
        dup = await db_session.get(SavedJob, uuid.UUID(made.json()["saved_job_id"]))
        return sj, dup, ev

    async def test_link_merges_into_the_real_job_and_undo_splits_it(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, dup, ev = await self._pair(client, db_session, test_user, monkeypatch)
        interview = (await _stage(db_session, test_user, "Interview")).id
        applied = (await _stage(db_session, test_user, "Applied")).id
        assert dup.origin == "email" and dup.pipeline_stage_id == interview

        opts = (await client.get(f"/v1/saved-jobs/{dup.id}/link-options")).json()
        ids = [o["saved_job_id"] for o in opts]
        assert str(sj.id) in ids and str(dup.id) not in ids

        r = await client.post(
            f"/v1/saved-jobs/{dup.id}/link", json={"target_id": str(sj.id)}
        )
        assert r.status_code == 200
        out = r.json()
        assert out["saved_job_id"] == str(sj.id) and out["stage"] == "Interview"
        assert out["job_listing_id"] == str(sj.job_listing_id)
        await db_session.refresh(sj)
        await db_session.refresh(dup)
        assert sj.pipeline_stage_id == interview and dup.is_archived
        event = await db_session.get(DetectedEvent, uuid.UUID(ev["id"]))
        await db_session.refresh(event)
        assert event.saved_job_id == sj.id
        assert event.previous_stage_id == applied  # its Undo returns the real job
        listed = [j["id"] for j in (await client.get("/v1/saved-jobs/")).json()]
        assert str(dup.id) not in listed and str(sj.id) in listed

        r = await client.post(f"/v1/saved-jobs/{dup.id}/unlink", json=out["undo"])
        assert r.status_code == 204
        for row in (sj, dup, event):
            await db_session.refresh(row)
        assert sj.pipeline_stage_id == applied and not dup.is_archived
        assert event.saved_job_id == dup.id

    async def test_a_job_already_further_along_stays_put(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, dup, _ = await self._pair(client, db_session, test_user, monkeypatch)
        offer = (await _stage(db_session, test_user, "Offer")).id
        sj.pipeline_stage_id = offer
        await db_session.flush()
        r = await client.post(
            f"/v1/saved-jobs/{dup.id}/link", json={"target_id": str(sj.id)}
        )
        assert r.json()["stage"] == "Offer" and r.json()["undo"]["stage_moved"] is False

    async def test_guards(self, client, db_session, test_user, enc_key, monkeypatch):
        sj, dup, _ = await self._pair(client, db_session, test_user, monkeypatch)
        url = f"/v1/saved-jobs/{dup.id}/link"
        assert (
            await client.post(url, json={"target_id": str(dup.id)})
        ).status_code == 422
        r = await client.post(url, json={"target_id": str(uuid.uuid4())})
        assert r.status_code == 404
        # Only a job made from an email can be folded into another.
        r = await client.post(
            f"/v1/saved-jobs/{sj.id}/link", json={"target_id": str(dup.id)}
        )
        assert r.status_code == 409
        # Undo without a link does nothing.
        r = await client.post(
            f"/v1/saved-jobs/{dup.id}/unlink", json={"target_id": str(sj.id)}
        )
        assert r.status_code == 409
