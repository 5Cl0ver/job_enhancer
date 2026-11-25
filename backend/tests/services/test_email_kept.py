"""Every email about a saved job is kept (spec 027).

Shaped like the real misses of 2026-11-25 (invented companies and people):
confirmations and second interviews for a card already at that stage were
thrown away, and single-company emails were read as job alerts because many
saved jobs share a title or have generic names.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.detected_event import DetectedEvent
from app.models.pipeline_stage import PipelineStage
from app.services.email_match import looks_like_digest
from app.services.email_scan import EmailMessage, detect_events
from tests.services.test_email_scan import _make_account, _make_saved_job


async def _stage(db, user, name):
    return await db.scalar(
        select(PipelineStage.id).where(
            PipelineStage.user_id == user.id, PipelineStage.name == name
        )
    )


def _mail(subject, body, sender, uid=None):
    return EmailMessage(
        uid=uid or uuid.uuid4().hex[:8],
        from_addr=sender,
        subject=subject,
        body=body,
        folder="INBOX",
        uidvalidity=1,
    )


async def _rows(db, acct):
    return list(
        await db.scalars(
            select(DetectedEvent).where(DetectedEvent.email_account_id == acct.id)
        )
    )


@pytest.mark.asyncio
class TestNeverThrownAway:
    async def test_thanks_for_applying_after_the_card_is_in_applied(
        self, db_session, test_user
    ):
        sid = await _stage(db_session, test_user, "Applied")
        job = await _make_saved_job(
            db_session, test_user, "Brightwave Relays", "IT Systems Engineer", sid
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Thank you for applying to Brightwave Relays",
            "Hi Sam, thank you for applying for the IT Systems Engineer role at "
            "Brightwave Relays. We have received your application.",
            "Brightwave Relays <careers@brightwaverelays.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == []
        (kept,) = result.noted
        assert (kept.saved_job_id, kept.event_type, kept.status) == (
            job.id,
            "applied",
            "noted",
        )
        # Stored, so a rescan never repeats it.
        again = await detect_events(db_session, acct, [msg])
        assert again.noted == [] and len(await _rows(db_session, acct)) == 1

    async def test_a_second_interview_email_while_in_interview(
        self, db_session, test_user
    ):
        sid = await _stage(db_session, test_user, "Interview")
        job = await _make_saved_job(
            db_session, test_user, "Marrow Paving", "IT Support Specialist", sid
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Sam Rivera - Marrow Paving Employment Interview",
            "Hi Sam, we'd like to schedule your interview for the IT Support "
            "Specialist position on Thursday at 10am. Please confirm.",
            "Dana Holt <dana@marrowpaving.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        (kept,) = result.noted
        assert (kept.saved_job_id, kept.event_type) == (job.id, "interview")

    async def test_a_second_rejection(self, db_session, test_user):
        sid = await _stage(db_session, test_user, "Rejected")
        job = await _make_saved_job(
            db_session, test_user, "Quarrystone Analytics", "ERP Administrator", sid
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "An update on your application from Quarrystone Analytics",
            "Thank you for your interest in the ERP Administrator role. "
            "Unfortunately we have decided to move forward with other candidates.",
            "Quarrystone Analytics <jobs@quarrystone.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        (kept,) = result.noted
        assert (kept.saved_job_id, kept.event_type) == (job.id, "rejected")


@pytest.mark.asyncio
class TestNotAJobAlert:
    async def test_a_title_inside_a_longer_title(self, db_session, test_user):
        for co in ("Fennel Works", "Gullwing Labs", "Hollow Pine", "Ironleaf Co"):
            await _make_saved_job(db_session, test_user, co, "Systems Administrator")
        sid = await _stage(db_session, test_user, "Applied")
        job = await _make_saved_job(
            db_session,
            test_user,
            "Quillfeather Talent Partners",
            "Endpoint Systems Administrator",
            sid,
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Application to Endpoint Systems Administrator",
            "Thanks for applying to the Endpoint Systems Administrator role with "
            "Quillfeather Talent Partners. A recruiter will review your application.",
            "Quillfeather Talent Partners <jobs@quillfeather.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.looked_at == []
        (kept,) = result.noted
        assert kept.saved_job_id == job.id

    async def test_the_same_title_at_many_companies(self, db_session, test_user):
        for co in ("Juniper Mills", "Kestrel Foods", "Lumen Freight"):
            await _make_saved_job(db_session, test_user, co, "Business Systems Analyst")
        sid = await _stage(db_session, test_user, "Applied")
        job = await _make_saved_job(
            db_session,
            test_user,
            "Copperkettle Fitness",
            "Business Systems Analyst II - CRM",
            sid,
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Your Business Systems Analyst II - CRM Application",
            "Thank you for applying for Business Systems Analyst II - CRM at "
            "Copperkettle Fitness. We received your application.",
            "Copperkettle Fitness <careers@copperkettle.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.looked_at == []
        (kept,) = result.noted
        assert kept.saved_job_id == job.id

    async def test_generic_company_names_in_a_signature(self, db_session, test_user):
        for co in ("City of Springfield", "Washington", "Security", "The 30"):
            await _make_saved_job(db_session, test_user, co, "Help Desk Analyst")
        sid = await _stage(db_session, test_user, "Interview")
        job = await _make_saved_job(
            db_session, test_user, "Marrow Paving", "IT Support Specialist", sid
        )
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Sam Rivera - Marrow Paving Employment Interview",
            "Hi Sam, here is the link for your interview tomorrow.\n\n"
            "Dana Holt | Recruiter | Marrow Paving\n"
            "1200 Industrial Way, City of Springfield, Washington\n"
            "Security notice: never share passwords. The 30 best places to work.",
            "Dana Holt <dana@marrowpaving.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        # Not a job alert, and never lost: on the job, or asked about.
        assert result.looked_at == [] and result.skipped == {}
        kept = [*result.noted, *result.review, *result.created]
        assert len(kept) == 1
        assert kept[0].saved_job_id in (job.id, None)
        assert kept[0].event_type == "interview"

    async def test_a_real_job_board_alert_is_still_one(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Fennel Works", "Data Engineer")
        await _make_saved_job(db_session, test_user, "Gullwing Labs", "Cloud Engineer")
        await _make_saved_job(db_session, test_user, "Hollow Pine", "Network Engineer")
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "We have received your application? Jobs picked for you",
            "Jobs for you: Data Engineer at Fennel Works. Apply now.\n"
            "Cloud Engineer at Gullwing Labs. Apply now.\n"
            "Network Engineer at Hollow Pine. Apply now.",
            "Glassdoor Jobs <noreply@glassdoor.com>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == [] and result.noted == []
        if result.looked_at:  # kept for 30 days, never on a job
            (row,) = result.looked_at
            assert (row.status, row.saved_job_id) == ("skipped", None)
            assert row.skip_reason in ("digest", "job_alert", "no_saved_job")


def _jobs(*pairs):
    return [
        {"id": uuid.uuid4(), "company": c, "title": t, "pipeline_stage_id": None}
        for c, t in pairs
    ]


def test_digest_counts_mentions_not_saved_jobs():
    jobs = _jobs(
        ("Fennel Works", "Systems Administrator"),
        ("Gullwing Labs", "Systems Administrator"),
        ("Hollow Pine", "Systems Administrator"),
        ("Quillfeather", "Endpoint Systems Administrator"),
    )
    one = "Application to Endpoint Systems Administrator. Thanks for applying."
    assert not looks_like_digest(jobs, subject="", text=one)
    three = (
        "Systems Administrator at Fennel Works. Apply now. "
        "Endpoint Systems Administrator at Quillfeather. Apply now. "
        "Systems Administrator at Gullwing Labs. Apply now."
    )
    assert looks_like_digest(jobs, subject="", text=three)


def test_digest_ignores_generic_company_names():
    jobs = _jobs(
        ("City of Springfield", "Analyst"),
        ("Washington", "Analyst I"),
        ("Security", "Analyst II"),
        ("Fennel Works", "Engineer"),
        ("Gullwing Labs", "Engineer I"),
        ("Hollow Pine", "Engineer II"),
    )
    signature = "City of Springfield, Washington. Security tips inside."
    assert not looks_like_digest(jobs, subject="", text=signature)
    named = "Openings at Fennel Works, Gullwing Labs and Hollow Pine this week."
    assert looks_like_digest(jobs, subject="", text=named)


@pytest.mark.asyncio
class TestReviewFindings:
    async def test_a_hiring_system_repeating_one_title_is_not_an_alert(
        self, db_session, test_user
    ):
        sid = await _stage(db_session, test_user, "Applied")
        job = await _make_saved_job(
            db_session, test_user, "Quarrystone Analytics", "Data Analyst", sid
        )
        await _make_saved_job(db_session, test_user, "Fennel Works", "Data Analyst")
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Interview invitation: Data Analyst",
            "Hi Sam, thanks for applying for Data Analyst. We'd like to invite you "
            "to interview for the Data Analyst position at Quarrystone Analytics.",
            "Quarrystone Analytics <noreply@smartrecruiters.com>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.looked_at == [] and "job_alert" not in result.skipped
        (row,) = [*result.created, *result.review]
        assert row.event_type == "interview"
        assert row.saved_job_id in (job.id, None)

    async def test_a_job_saved_later_still_gets_its_email(self, db_session, test_user):
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Thank you for applying to Brightwave Relays",
            "Thank you for applying for the IT Systems Engineer role at Brightwave "
            "Relays. We have received your application.",
            "Brightwave Relays <careers@brightwaverelays.example>",
            uid="901",
        )
        first = await detect_events(db_session, acct, [msg])
        (looked,) = first.looked_at
        assert looked.skip_reason == "no_saved_job"

        job = await _make_saved_job(
            db_session, test_user, "Brightwave Relays", "IT Systems Engineer"
        )
        again = await detect_events(db_session, acct, [msg])
        (row,) = [*again.created, *again.noted]
        assert row.saved_job_id == job.id and row.id == looked.id  # same row
        rows = await _rows(db_session, acct)
        assert len(rows) == 1 and rows[0].status in ("pending", "noted")

    async def test_looked_at_again_and_still_not_a_job_adds_nothing(
        self, db_session, test_user
    ):
        acct = await _make_account(db_session, test_user)
        msg = _mail(
            "Thank you for applying to Brightwave Relays",
            "We have received your application.",
            "Brightwave Relays <careers@brightwaverelays.example>",
            uid="902",
        )
        await detect_events(db_session, acct, [msg])
        again = await detect_events(db_session, acct, [msg])
        assert again.looked_at == []
        assert len(await _rows(db_session, acct)) == 1


def test_titles_side_by_side_still_count_apart():
    jobs = _jobs(
        ("Fennel Works", "Data Engineer"),
        ("Gullwing Labs", "Cloud Engineer"),
        ("Hollow Pine", "Network Engineer"),
    )
    text = "Data Engineer | Cloud Engineer | Network Engineer"
    assert looks_like_digest(jobs, subject="", text=text)
    repeated = "Data Engineer. Data Engineer. Data Engineer, Cloud Engineer."
    assert not looks_like_digest(jobs, subject="", text=repeated)
