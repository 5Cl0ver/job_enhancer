"""Mail that talks about interviews but isn't one (a live-test report).

Invented companies and senders; the shapes match what was misread: an ad for
interview practice, a "what happens next" step list in a confirmation, and a
copy of a job email the user sent themselves.
"""

import pytest

from app.services.email_classify import (
    APPLIED,
    ASSESSMENT,
    INTERVIEW,
    UNKNOWN,
    classify,
)
from app.services.email_scan import EmailMessage, detect_events
from tests.services.test_email_scan import _make_account, _make_saved_job


class TestInterviewPracticeAds:
    def test_mock_interview_ad_is_not_an_interview(self):
        # Mentions "your application", so it gets past the relevance gate; the
        # practice-tool wording is what marks it as an ad.
        result = classify(
            "Your application is in - now ace the interview",
            "Thanks for your application. Schedule your mock interview today and get "
            "feedback from our AI interview coach. Unsubscribe at any time.",
            "hello@prepwell.example",
            bulk=True,
        )
        assert result.event == UNKNOWN
        assert result.reason == "promo"

    def test_interview_prep_newsletter_is_not_an_interview(self):
        result = classify(
            "5 interview tips for your phone screen",
            "Practice interviews with our interview prep course. View in browser.",
            "news@careerlift.example",
            bulk=True,
        )
        assert result.event == UNKNOWN

    def test_a_real_invite_still_counts(self):
        # Personal mail from an employer mentioning "practice" is not an ad.
        result = classify(
            "Interview with Brambleworks",
            "We'd like to schedule an interview for the Analyst role. "
            "What's your availability on Thursday?",
            "talent@brambleworks.example",
        )
        assert result.event == INTERVIEW


class TestStepLists:
    def test_process_flow_in_a_confirmation_is_not_an_assessment(self):
        result = classify(
            "Thanks for applying to Vellacor",
            "We have received your application for Data Analyst.\n"
            "What happens next:\n"
            "Apply → Complete Assessment → Interview → Offer\n"
            "We'll be in touch.",
            "no-reply@vellacor.example",
        )
        assert result.event == APPLIED

    def test_button_label_alone_is_not_a_request(self):
        result = classify(
            "Thanks for applying to Vellacor",
            "We have received your application.\nComplete Assessment\nView Status",
            "no-reply@vellacor.example",
        )
        assert result.event not in (ASSESSMENT, INTERVIEW)

    def test_a_real_assessment_request_still_counts(self):
        result = classify(
            "Next step: online assessment",
            "Please complete the online assessment for the Data Analyst role "
            "within 3 days using the link below.",
            "talent@vellacor.example",
        )
        assert result.event == ASSESSMENT


@pytest.mark.asyncio
class TestOwnMail:
    async def test_mail_from_your_own_address_is_skipped(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Globex", "Frontend Developer")
        acct = await _make_account(db_session, test_user)  # me@yahoo.com
        forwarded = EmailMessage(
            uid="9",
            from_addr="Me <ME@yahoo.com>",
            subject="Fwd: Interview with Globex — Frontend Developer",
            body="We'd like to schedule a call. What's your availability?",
            folder="INBOX",
            uidvalidity=1,
        )
        result = await detect_events(db_session, acct, [forwarded])
        assert result.created == []
        assert result.skipped.get("own_mail") == 1
        # A later scan skips it again; it never becomes an update.
        again = await detect_events(db_session, acct, [forwarded])
        assert again.created == []

    async def test_the_same_email_from_the_employer_still_counts(
        self, db_session, test_user
    ):
        await _make_saved_job(db_session, test_user, "Globex", "Frontend Developer")
        acct = await _make_account(db_session, test_user)
        original = EmailMessage(
            uid="8",
            from_addr="talent@globex.example",
            subject="Interview with Globex — Frontend Developer",
            body="We'd like to schedule a call. What's your availability?",
            folder="INBOX",
            uidvalidity=1,
        )
        result = await detect_events(db_session, acct, [original])
        assert len(result.created) == 1
