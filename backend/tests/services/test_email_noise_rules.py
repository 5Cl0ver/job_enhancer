"""Noise rules for the Email Updates page — all synthetic.

- "Thank you for applying" is an application confirmation.
- Job alerts, recommendation digests and "based on your profile" mail are not
  updates (and never questions).
- "Acme" and "Acme, Inc." with the same title are one job, not a question.
- A low-value confirmation with an unclear job is hidden, not a question;
  only an important update (interview, assessment, offer, rejection) whose job
  is unclear asks the user.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.api.v1.email import category_of
from app.models.detected_event import DetectedEvent
from app.services.email_classify import APPLIED, UNKNOWN, classify
from app.services.email_match import (
    MATCHED,
    REVIEW,
    SEVERAL_ROLES,
    collapse_duplicates,
    looks_like_digest,
    match_job,
)
from app.services.email_scan import EmailMessage, detect_events
from tests.services.test_email_scan import _make_account, _make_saved_job, _stage_id

ATS = "Brambleworks Careers <no-reply@brambleworks.example>"


class TestConfirmations:
    @pytest.mark.parametrize(
        "body",
        [
            "Thank you for applying to Brambleworks! We will review your application.",
            "Thanks for applying for the Full Stack Developer position.",
            "Thank you for your application. Our team is reviewing it now.",
        ],
    )
    def test_thank_you_for_applying_is_a_confirmation(self, body):
        assert classify("Your application", body, ATS).event == APPLIED

    def test_thank_you_then_rejection_is_a_rejection(self):
        v = classify(
            "Your application",
            "Thank you for applying. Unfortunately, we have decided to move forward "
            "with other candidates.",
            ATS,
        )
        assert v.event == "rejected"


class TestAlertsAndDigests:
    @pytest.mark.parametrize(
        "subject,body",
        [
            ("Jobs recommended for you", "Based on your profile, these roles fit you."),
            ("Top job picks for you", "Software Engineer at Tidelock. Easy Apply."),
            ("12 new jobs", "New opportunities matching your job search this week."),
            ("Vellacor is hiring", "Apply now to Data Engineer and 4 more roles."),
            ("People also viewed", "You may be a great fit for these jobs."),
        ],
    )
    def test_alerts_and_recommendations_are_not_updates(self, subject, body):
        v = classify(subject, body, "Jobs <jobs-noreply@linkedin.com>", bulk=True)
        assert v.event == UNKNOWN

    def test_your_profile_alone_does_not_pass_the_bulk_gate(self):
        v = classify(
            "Update",
            "Recruiters viewed your profile. Complete your background to get more "
            "interview invitations.",
            "Jobs <notifications@platform.example>",
            bulk=True,
        )
        assert v.event == UNKNOWN

    def test_bulk_ats_rejection_still_counts(self):
        v = classify(
            "Your application to Brambleworks",
            "Unfortunately we will not be moving forward with your application.",
            ATS,
            bulk=True,
        )
        assert v.event == "rejected"


def _jobs():
    saved = datetime(2026, 9, 1, tzinfo=UTC)
    return [
        {
            "id": "a",
            "company": "Brambleworks",
            "title": "Full Stack Developer",
            "saved_at": saved,
        },
        {
            "id": "b",
            "company": "Tidelock Systems",
            "title": "Platform Engineer",
            "saved_at": saved,
        },
        {
            "id": "c",
            "company": "Orbweaver Analytics",
            "title": "Data Analyst",
            "saved_at": saved,
        },
        {
            "id": "d",
            "company": "Lumenhollow",
            "title": "QA Automation Engineer",
            "saved_at": saved,
        },
    ]


class TestDigestDetection:
    def test_three_saved_titles_across_companies_is_a_digest(self):
        text = (
            "Full Stack Developer - Brambleworks\nPlatform Engineer - Tidelock\n"
            "Data Analyst - Orbweaver"
        )
        assert looks_like_digest(_jobs(), subject="Jobs for you", text=text)

    def test_three_saved_companies_is_a_digest(self):
        text = "Brambleworks, Lumenhollow and Orbweaver Analytics are hiring."
        assert looks_like_digest(_jobs(), text=text)

    def test_one_company_update_is_not_a_digest(self):
        text = (
            "Thank you for applying for the Full Stack Developer role at "
            "Brambleworks. Unfortunately we have decided to move forward."
        )
        assert not looks_like_digest(_jobs(), subject="Your application", text=text)

    def test_one_company_with_several_roles_is_not_a_digest(self):
        jobs = [
            {"id": i, "company": "Quillfeather Labs", "title": t}
            for i, t in enumerate(
                ["Backend Engineer", "Frontend Engineer", "Data Engineer"]
            )
        ]
        text = (
            "Your Backend Engineer, Frontend Engineer and Data Engineer applications."
        )
        assert not looks_like_digest(jobs, text=text)


class TestSameCompanyNames:
    def _dupes(self):
        old = datetime(2026, 8, 1, tzinfo=UTC)
        return [
            {
                "id": "old",
                "company": "Acme",
                "title": "Support Engineer",
                "saved_at": old,
                "apply_url": "https://jobs.example/acme/support-engineer-88123",
            },
            {
                "id": "new",
                "company": "Acme, Inc.",
                "title": "Support Engineer",
                "saved_at": old + timedelta(days=9),
            },
        ]

    def test_suffix_variants_with_same_title_are_one_job(self):
        reps, rep_of = collapse_duplicates(self._dupes())
        assert len(reps) == 1 and rep_of == {"old": "new", "new": "new"}

    def test_duplicate_saves_never_cause_a_question(self):
        m = match_job(
            self._dupes(),
            subject="Your Acme application",
            from_addr="Acme Talent <talent@acme.example>",
            text="Unfortunately we will not be moving forward with your application.",
            date=datetime(2026, 9, 20, tzinfo=UTC),
        )
        assert m.status == MATCHED and m.job["id"] == "new"

    def test_a_duplicates_job_link_still_counts(self):
        m = match_job(
            self._dupes(),
            subject="About your application",
            text="See https://jobs.example/acme/support-engineer-88123 for details.",
        )
        assert (m.status, m.evidence, m.job["id"]) == (MATCHED, "job_url", "new")

    def test_different_roles_at_one_company_still_ask(self):
        jobs = self._dupes() + [
            {"id": "x", "company": "ACME INC", "title": "Sales Engineer"}
        ]
        m = match_job(
            jobs,
            subject="Your Acme application",
            text="We would like to schedule an interview with you.",
        )
        assert (m.status, m.evidence) == (REVIEW, SEVERAL_ROLES)
        assert {c["id"] for c in m.candidates} == {"new", "x"}


class TestNamedRole:
    """The company-only rule ("your only saved job there") must not pin an
    email about a DIFFERENT role at that company on the saved job."""

    def _job(self):
        return [{"id": "s", "company": "Acme, Inc.", "title": "Support Engineer"}]

    def _match(self, subject, text):
        return match_job(
            self._job(),
            subject=subject,
            from_addr="Acme Talent <talent@acme.example>",
            text=text,
        )

    def test_other_named_role_is_not_this_job(self):
        m = self._match(
            "Your application",
            "Thank you for your application for the Sales Manager position at Acme. "
            "Unfortunately we will not be moving forward.",
        )
        assert m.status == "none" and m.job is None

    def test_same_role_reworded_still_matches(self):
        m = self._match(
            "Your application",
            "Thank you for your application for the Support Engineer II role at Acme.",
        )
        assert m.status == MATCHED and m.job["id"] == "s"

    def test_no_role_named_uses_the_only_saved_job(self):
        m = self._match(
            "An update from Acme",
            "Thank you for your interest in Acme. Unfortunately we will not be moving "
            "forward with your application.",
        )
        assert (m.status, m.evidence) == (MATCHED, "company_date")

    def test_company_name_is_not_mistaken_for_a_role(self):
        m = self._match(
            "Thanks", "Thank you for applying to Acme, Inc. We'll be in touch."
        )
        assert (m.status, m.evidence) == (MATCHED, "company_date")


def _msg(uid, subject, body, sender="Priya Okafor <priya@quillfeather.example>"):
    return EmailMessage(
        uid=uid,
        from_addr=sender,
        subject=subject,
        body=body,
        newest_text=body,
        folder="INBOX",
        uidvalidity=1,
    )


@pytest.mark.asyncio
class TestScanGrouping:
    async def _two_roles(self, db, user):
        applied = await _stage_id(db, user, "Applied")
        for title in ("Backend Engineer", "Frontend Engineer"):
            await _make_saved_job(
                db, user, "Quillfeather Labs", title, stage_id=applied
            )
        return await _make_account(db, user)

    async def test_unclear_rejection_is_a_question(self, db_session, test_user):
        acct = await self._two_roles(db_session, test_user)
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "1",
                    "Quillfeather Labs update",
                    "Unfortunately we will not be moving forward with your application.",
                )
            ],
        )
        (q,) = r.review
        assert q.status == "needs_review" and category_of(q) == "question"

    async def test_near_miss_company_spelling_is_unsaved_not_a_question(
        self, db_session, test_user
    ):
        acct = await _make_account(db_session, test_user)
        await _make_saved_job(db_session, test_user, "Quillfeather", "Backend Engineer")
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "7",
                    "Your application",
                    "Thanks from the Quilfeather Hiring Suite team. Unfortunately we will "
                    "not be moving forward with your application.",
                    sender="Hiring Suite <no-reply@hiringsuite.example>",
                )
            ],
        )
        # Look-alike spelling: treated as a job you didn't save, never a question.
        assert r.review == [] and r.created == [] and r.hidden == []
        (u,) = r.unsaved
        assert u.match_evidence == "fuzzy_company" and category_of(u) == "unsaved"

    async def test_unclear_confirmation_is_hidden_not_a_question(
        self, db_session, test_user
    ):
        acct = await _make_account(db_session, test_user)
        for title in ("Backend Engineer", "Frontend Engineer"):
            await _make_saved_job(db_session, test_user, "Quillfeather Labs", title)
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "2",
                    "Thanks for applying",
                    "Thank you for applying to Quillfeather Labs!",
                )
            ],
        )
        assert r.review == [] and r.created == []
        (h,) = r.hidden
        assert h.event_type == "applied" and category_of(h) == "hidden"

    async def test_clear_confirmation_is_a_confirmation(self, db_session, test_user):
        acct = await _make_account(db_session, test_user)
        await _make_saved_job(
            db_session, test_user, "Brambleworks", "Full Stack Developer"
        )
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "3",
                    "Thanks for applying",
                    "Thank you for applying for the Full Stack Developer role at Brambleworks.",
                    sender=ATS,
                )
            ],
        )
        (c,) = r.created
        assert c.event_type == "applied" and category_of(c) == "confirmation"

    async def test_clear_rejection_is_important(self, db_session, test_user):
        acct = await _make_account(db_session, test_user)
        await _make_saved_job(
            db_session, test_user, "Brambleworks", "Full Stack Developer"
        )
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "4",
                    "Your Full Stack Developer application",
                    "Unfortunately we have decided to move forward with other candidates.",
                    sender=ATS,
                )
            ],
        )
        (c,) = r.created
        assert category_of(c) == "important" and c.target_stage == "Rejected"

    async def test_digest_is_skipped_and_counted(self, db_session, test_user):
        acct = await _make_account(db_session, test_user)
        for co, title in (
            ("Brambleworks", "Full Stack Developer"),
            ("Tidelock Systems", "Platform Engineer"),
            ("Orbweaver Analytics", "Data Analyst"),
        ):
            await _make_saved_job(db_session, test_user, co, title)
        body = (
            "We'd like to invite you to apply. Full Stack Developer at Brambleworks. "
            "Platform Engineer at Tidelock. Data Analyst at Orbweaver."
        )
        r = await detect_events(
            db_session, acct, [_msg("5", "Your next interview?", body)]
        )
        assert r.created == r.review == r.hidden == []
        assert r.skipped == {"job_alert": 1}

    async def test_duplicate_saved_job_moves_one_card(self, db_session, test_user):
        acct = await _make_account(db_session, test_user)
        older = await _make_saved_job(db_session, test_user, "Acme", "Support Engineer")
        older.created_at = datetime(2026, 8, 1, tzinfo=UTC)
        newer = await _make_saved_job(
            db_session, test_user, "Acme, Inc.", "Support Engineer"
        )
        newer.created_at = datetime(2026, 8, 20, tzinfo=UTC)
        await db_session.flush()
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "6",
                    "Your Support Engineer application at Acme",
                    "We'd like to schedule an interview with you next week.",
                    sender="Acme Talent <talent@acme.example>",
                )
            ],
        )
        assert r.review == []
        (c,) = r.created
        # One card — the most recently saved copy — not a question.
        assert c.event_type == "interview" and c.saved_job_id == newer.id


def test_category_mapping():
    def ev(status, kind):
        return DetectedEvent(id=uuid.uuid4(), status=status, event_type=kind)

    assert category_of(ev("pending", "offer")) == "important"
    assert category_of(ev("pending", "applied")) == "confirmation"
    assert category_of(ev("needs_review", "rejected")) == "question"
    assert category_of(ev("needs_review", "unsure")) == "hidden"  # older rows
    assert category_of(ev("hidden", "applied")) == "hidden"
