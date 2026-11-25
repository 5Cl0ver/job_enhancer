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
from app.models.detected_event import STATUS_PENDING, DetectedEvent
from app.models.email_account import EmailAccount
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services import email_sync
from app.services.email_match import (
    MATCHED,
    company_initials,
    match_job,
    sender_is_saved_company,
)
from app.services.email_scan import EmailMessage
from app.services.job_links import _event_facts, place, rank_jobs
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

    def test_capitals_in_the_body_never_count(self):
        # Another company's interview for the same title, whose job text
        # happens to use the saved company's initials.
        jobs = [
            {"id": 1, "company": "Amberline Web Services", "title": "Data Engineer"}
        ]
        m = match_job(
            jobs,
            subject="Interview: Data Engineer",
            from_addr="Rowan Pike <rowan.pike@copperline.example>",
            text=f"{INTERVIEW} Experience with AWS is a plus.",
        )
        assert m.status != MATCHED

    def test_domain_parts_are_never_initials(self):
        assert company_initials("Central Office Mechanics") == ""  # "com"
        assert company_initials("Equal Employment Office") == ""  # "eeo"
        assert not sender_is_saved_company(
            [{"id": 1, "company": "Central Office Mechanics", "title": "Clerk"}],
            "a@shop.com.au",
        )


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
        # The title puts a job first, but only its company makes it "likely".
        by_subject = rank_jobs(jobs, subjects=[f"Re: {TITLE} interview"])
        assert by_subject[0]["id"] == 2 and not by_subject[0]["likely"]
        by_name = rank_jobs(jobs, title="Data Engineer")
        assert by_name[0]["id"] == 1 and not by_name[0]["likely"]
        both = rank_jobs(jobs, company="Vellacor", title="Data Engineer")
        assert both[0]["id"] == 1 and both[0]["likely"]
        # One shared word is not the title.
        loose = rank_jobs(jobs, subjects=["The engineer team says hi"])
        assert not any(j["likely"] for j in loose)

    def test_one_common_word_is_not_the_company(self):
        jobs = [{"id": 1, "company": AGENCY, "title": TITLE}]
        assert not rank_jobs(jobs, company="Services")[0]["likely"]
        assert not rank_jobs(jobs, title="Analyst")[0]["likely"]


def _ev(company="", title="", subject="Next steps", sender="a@gmail.com", date=None):
    return _event_facts(
        SimpleNamespace(
            id="e",
            job_company=company,
            job_title=title,
            subject=subject,
            from_addr=sender,
            email_date=date,
            target_stage="Interview",
        )
    )


def _placed(ev, jobs, excluded=None):
    return place([ev], jobs, excluded or {}).get("e", {}).get("id")


class TestPlace:
    """Which updates go on a saved job by themselves: only those that fit one
    job exactly (spec 014)."""

    JOBS = [
        {"id": 1, "company": "Vellacor Robotics", "title": "Platform Engineer"},
        {"id": 2, "company": AGENCY, "title": TITLE},
    ]

    def test_the_company_named_or_its_own_domain(self):
        assert _placed(_ev(company="Vellacor Robotics, Inc."), self.JOBS) == 1
        assert _placed(_ev(sender="Rowan <r@dhs.example.gov>"), self.JOBS) == 2
        # Its whole name in the subject, when the email named no company.
        assert _placed(_ev(subject=f"{AGENCY}: next steps"), self.JOBS) == 2
        assert _placed(_ev(), self.JOBS) is None  # nothing points anywhere

    def test_another_role_at_the_company_is_not_this_job(self):
        ev = _ev(company="Vellacor Robotics", title="Senior Accountant")
        assert _placed(ev, self.JOBS) is None
        same = _ev(company="Vellacor Robotics", title="Platform Engineer")
        assert _placed(same, self.JOBS) == 1

    def test_look_alike_companies_and_loose_words_never_count(self):
        assert _placed(_ev(company="Vellacorp Robotics"), self.JOBS) is None
        # One word of a saved company in the subject, from another company.
        jobs = [{"id": 3, "company": "Target", "title": "Analyst"}]
        ev = _ev(
            company="Quillfeather",
            subject="Interview: target start date",
            sender="r@quillfeather.example",
        )
        assert _placed(ev, jobs) is None
        assert _placed(_ev(subject="Interview: target start date"), jobs) is None

    def test_a_job_site_saved_as_the_company_never_collects_updates(self):
        jobs = [{"id": 4, "company": "Indeed", "title": "Analyst"}]
        assert _placed(_ev(company="Indeed"), jobs) is None

    def test_the_sender_as_company_is_ignored(self):
        ev = _ev(company="Rowan Pike", sender="Rowan Pike <rowan.pike@dhs.example.gov>")
        assert ev["company"] == "" and _placed(ev, self.JOBS) == 2

    def test_not_from_long_before_the_job_was_saved(self):
        jobs = [{**self.JOBS[0], "saved_at": datetime(2026, 11, 1, tzinfo=UTC)}]
        old = _ev(company="Vellacor Robotics", date=datetime(2025, 6, 1, tzinfo=UTC))
        assert _placed(old, jobs) is None
        recent = _ev(
            company="Vellacor Robotics", date=datetime(2026, 10, 20, tzinfo=UTC)
        )
        assert _placed(recent, jobs) == 1

    def test_ties_wrong_jobs_and_duplicate_saves(self):
        twins = [
            *self.JOBS,
            {"id": 5, "company": "Vellacor Robotics", "title": "Analyst"},
        ]
        assert _placed(_ev(company="Vellacor Robotics"), twins) is None  # which one?
        assert _placed(_ev(company="Vellacor Robotics"), self.JOBS, {"e": {1}}) is None
        dupes = [
            {**self.JOBS[0], "saved_at": datetime(2026, 1, 1, tzinfo=UTC)},
            {
                "id": 6,
                "company": "Vellacor Robotics, Inc.",
                "title": "Platform Engineer",
                "saved_at": datetime(2026, 2, 1, tzinfo=UTC),
            },
        ]
        assert _placed(_ev(company="Vellacor Robotics"), dupes) == 6  # the newest


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

        # Undo: the card goes back and the update is listed again, to link
        # elsewhere or add as a new job.
        r = await client.post(f"/v1/email/events/{ev['id']}/unlink")
        assert r.status_code == 200 and r.json()["status"] == "unsaved"
        assert r.json()["saved_job_id"] is None
        await db_session.refresh(sj)
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Applied")).id
        )
        listed = [e["id"] for e in (await client.get("/v1/email/events")).json()]
        assert ev["id"] in listed
        again = await client.post(f"/v1/email/events/{ev['id']}/unlink")
        assert again.status_code == 409

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

    async def test_a_waiting_update_behind_the_real_job_is_set_aside(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, dup, ev = await self._pair(client, db_session, test_user, monkeypatch)
        first = await db_session.get(DetectedEvent, uuid.UUID(ev["id"]))
        waiting = DetectedEvent(
            id=uuid.uuid4(),
            user_id=test_user.id,
            email_account_id=first.email_account_id,
            saved_job_id=dup.id,
            event_type="applied",
            target_stage="Applied",
            message_uid="77",
            status=STATUS_PENDING,
        )
        db_session.add(waiting)
        await db_session.flush()
        out = (
            await client.post(
                f"/v1/saved-jobs/{dup.id}/link", json={"target_id": str(sj.id)}
            )
        ).json()
        await db_session.refresh(waiting)
        # Approving it would move the real job (now Interview) back to Applied.
        assert waiting.status == "dismissed" and waiting.saved_job_id == sj.id
        await client.post(f"/v1/saved-jobs/{dup.id}/unlink", json=out["undo"])
        await db_session.refresh(waiting)
        assert waiting.status == STATUS_PENDING and waiting.saved_job_id == dup.id

    async def test_the_applied_date_comes_from_the_copy(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj, dup, _ = await self._pair(client, db_session, test_user, monkeypatch)
        when = datetime(2026, 10, 2, tzinfo=UTC)
        sj.applied_at, dup.applied_at = None, when
        await db_session.flush()
        out = (
            await client.post(
                f"/v1/saved-jobs/{dup.id}/link", json={"target_id": str(sj.id)}
            )
        ).json()
        await db_session.refresh(sj)
        assert sj.applied_at.replace(tzinfo=UTC) == when
        await client.post(f"/v1/saved-jobs/{dup.id}/unlink", json=out["undo"])
        await db_session.refresh(sj)
        assert sj.applied_at is None

    async def test_guards(self, client, db_session, test_user, enc_key, monkeypatch):
        sj, dup, _ = await self._pair(client, db_session, test_user, monkeypatch)
        r = await client.post(
            f"/v1/saved-jobs/{dup.id}/unlink", json={"target_id": str(dup.id)}
        )
        assert r.status_code == 422
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


@pytest.mark.asyncio
class TestPlacedAutomatically:
    """After each scan, updates the app couldn't place that point at one saved
    job's company go on that job by themselves (spec 014)."""

    async def _leftover(self, client, db_session, test_user, monkeypatch, **names):
        await _scan(client, monkeypatch)  # connects the inbox; no mail yet
        account = await db_session.scalar(select(EmailAccount))
        ev = DetectedEvent(
            id=uuid.uuid4(),
            user_id=test_user.id,
            email_account_id=account.id,
            event_type=names.get("kind", "interview"),
            target_stage=names.get("stage", "Interview"),
            from_addr="Rowan Pike <rowan.pike@gmail.com>",
            subject="Next phase of our recruitment process",
            message_uid=uuid.uuid4().hex[:8],
            status="unsaved",
            job_company=names.get("company", "Harbor Services, Department of"),
            job_title=names.get("title"),
        )
        db_session.add(ev)
        await db_session.flush()
        return account, ev

    async def test_a_leftover_update_moves_its_card_on_the_next_scan(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj = await _applied_job(db_session, test_user, company="Vellacor, Inc.")
        # Spec 028: it moves by itself only when it also named the role.
        _, ev = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor", title=TITLE
        )
        body = await _scan(client, monkeypatch)
        assert body["moved"] == 1
        await db_session.refresh(ev)
        await db_session.refresh(sj)
        assert ev.status == "auto_applied" and ev.saved_job_id == sj.id
        assert ev.match_evidence == "likely_job"
        assert (
            sj.pipeline_stage_id
            == (await _stage(db_session, test_user, "Interview")).id
        )

        # Wrong job: the card goes back, the update is listed again, and the
        # app never guesses it again.
        r = await client.post(f"/v1/email/events/{ev.id}/unlink")
        assert r.status_code == 200 and r.json()["status"] == "unsaved"
        await db_session.refresh(sj)
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Applied")).id
        )
        await db_session.refresh(ev)
        assert ev.not_jobs == [str(sj.id)]
        await _scan(client, monkeypatch)
        await db_session.refresh(ev)
        assert ev.status == "unsaved" and ev.saved_job_id is None

    async def test_by_company_alone_it_waits_for_a_tap(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        """Spec 028: a placement by company alone is a guess; it is put on the
        job but never moves the card without the user."""
        sj = await _applied_job(db_session, test_user, company="Vellacor")
        _, ev = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        body = await _scan(client, monkeypatch)
        assert body["moved"] == 0
        await db_session.refresh(ev)
        await db_session.refresh(sj)
        assert ev.status == "pending" and ev.saved_job_id == sj.id
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Applied")).id
        )

    async def test_without_auto_move_it_waits_for_a_tap(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj = await _applied_job(db_session, test_user, company="Vellacor")
        account, ev = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        account.auto_move = False
        await db_session.flush()
        await _scan(client, monkeypatch)
        await db_session.refresh(ev)
        assert ev.status == "pending" and ev.saved_job_id == sj.id

    async def test_nothing_to_move_keeps_it_with_the_job(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj = await _applied_job(db_session, test_user, company="Vellacor")
        sj.pipeline_stage_id = (await _stage(db_session, test_user, "Offer")).id
        _, ev = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        await _scan(client, monkeypatch)
        await db_session.refresh(ev)
        await db_session.refresh(sj)
        assert ev.status == "hidden" and ev.saved_job_id == sj.id
        assert sj.pipeline_stage_id == (await _stage(db_session, test_user, "Offer")).id

    async def test_two_jobs_there_or_no_company_stay_for_the_user(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await _applied_job(db_session, test_user, company="Vellacor", title="Analyst")
        await _applied_job(db_session, test_user, company="Vellacor", title="Engineer")
        _, ev = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        _, title_only = await self._leftover(
            client, db_session, test_user, monkeypatch, company="", title="Analyst"
        )
        await _scan(client, monkeypatch)
        for row in (ev, title_only):
            await db_session.refresh(row)
            assert row.status == "unsaved" and row.saved_job_id is None

    async def test_wrong_job_covers_the_senders_other_updates_and_sticks(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        sj = await _applied_job(db_session, test_user, company="Vellacor")
        _, interview = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor", title=TITLE
        )
        _, rejected = await self._leftover(
            client,
            db_session,
            test_user,
            monkeypatch,
            company="Vellacor",
            title=TITLE,
            kind="rejected",
            stage="Rejected",
        )
        await _scan(client, monkeypatch)  # both placed and moved (the helper scans too)
        await db_session.refresh(sj)
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Rejected")).id
        )

        # One "Wrong job" undoes both placements and puts the card back to
        # where it was before either.
        r = await client.post(f"/v1/email/events/{interview.id}/unlink")
        assert r.status_code == 200
        for row in (sj, interview, rejected):
            await db_session.refresh(row)
        assert (
            sj.pipeline_stage_id == (await _stage(db_session, test_user, "Applied")).id
        )
        for row in (interview, rejected):
            assert row.status == "unsaved" and row.not_jobs == [str(sj.id)]

        # A later email from the same recruiter isn't put on that job either.
        _, later = await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        later.match_evidence = None
        await db_session.flush()
        await _scan(client, monkeypatch)
        await db_session.refresh(later)
        assert later.status == "unsaved" and later.saved_job_id is None

    async def test_a_placement_never_teaches_the_sender(
        self, client, db_session, test_user, enc_key, monkeypatch
    ):
        await _applied_job(db_session, test_user, company="Vellacor")
        await self._leftover(
            client, db_session, test_user, monkeypatch, company="Vellacor"
        )
        await _scan(client, monkeypatch)
        # A later email from the same person that names nothing stays unplaced:
        # the app's own guess isn't proof of who that sender writes about.
        await _scan(
            client,
            monkeypatch,
            _mail("9", "Rowan Pike <rowan.pike@gmail.com>", subject="Quick question"),
        )
        rows = (
            await db_session.scalars(
                select(DetectedEvent).where(DetectedEvent.message_uid == "9")
            )
        ).all()
        assert all(r.match_evidence != "known_sender" for r in rows)
