"""Unit tests for the email → pipeline-signal classifier and job matcher."""

from app.services.email_classify import (
    APPLIED,
    INTERVIEW,
    REJECTED,
    UNKNOWN,
    classify_email,
    company_from_sender,
    match_email_to_job,
    stage_for_event,
)


class TestClassify:
    def test_application_received(self):
        assert (
            classify_email(
                "Thank you for applying to Acme",
                "We have received your application and will be in touch.",
                "no-reply@greenhouse.io",
            )
            == APPLIED
        )

    def test_interview_invite(self):
        assert (
            classify_email(
                "Next steps — interview with Acme",
                "We'd like to schedule a call to discuss the role. What's your availability?",
                "recruiter@acme.com",
            )
            == INTERVIEW
        )

    def test_calendly_invite_is_interview(self):
        assert (
            classify_email(
                "Let's find a time",
                "Please pick a slot: https://calendly.com/acme/screen",
                "talent@acme.com",
            )
            == INTERVIEW
        )

    def test_rejection(self):
        assert (
            classify_email(
                "Update on your application",
                "Unfortunately, we have decided to move forward with other candidates.",
                "no-reply@lever.co",
            )
            == REJECTED
        )

    def test_rejection_beats_other_signals(self):
        # A rejection email may still mention "your application" / "interview";
        # rejection must win so the card isn't wrongly moved to Interview.
        assert (
            classify_email(
                "Your application to Acme",
                "Thank you for applying and for the interview. Unfortunately we won't be "
                "moving forward.",
                "no-reply@acme.com",
            )
            == REJECTED
        )

    def test_recruiter_reply_from_human(self):
        assert (
            classify_email(
                "Re: Backend role",
                "Hi! I saw your resume and think you'd be a great fit for this position.",
                "jane.doe@acme.com",
            )
            == "recruiter"
        )

    def test_noreply_marketing_is_unknown(self):
        assert (
            classify_email(
                "Jobs you may like",
                "Here are 10 new roles near you.",
                "no-reply@indeed.com",
            )
            == UNKNOWN
        )

    def test_stage_mapping(self):
        assert stage_for_event(APPLIED) == "Applied"
        assert stage_for_event(INTERVIEW) == "Interview"
        assert stage_for_event(REJECTED) == "Rejected"
        assert stage_for_event(UNKNOWN) is None


class TestMatch:
    JOBS = [
        {"id": "1", "company": "Acme Corp", "title": "Backend Engineer"},
        {"id": "2", "company": "Globex", "title": "Frontend Developer"},
        {"id": "3", "company": "Initech", "title": "Systems Administrator"},
    ]

    def test_company_from_sender_ignores_relays(self):
        assert company_from_sender("no-reply@greenhouse.io") == ""
        assert company_from_sender("careers@acme.com") == "acme"
        assert company_from_sender("jane@globex.co.uk") == "globex"

    def test_match_by_sender_domain(self):
        m = match_email_to_job(
            self.JOBS, company_hint="Acme", subject="Application update"
        )
        assert m and m["id"] == "1"

    def test_match_by_subject_company(self):
        m = match_email_to_job(
            self.JOBS, subject="Your application to Globex — thank you"
        )
        assert m and m["id"] == "2"

    def test_title_in_subject_boosts(self):
        m = match_email_to_job(
            self.JOBS, subject="Systems Administrator role at Initech — next steps"
        )
        assert m and m["id"] == "3"

    def test_no_confident_match_returns_none(self):
        assert (
            match_email_to_job(self.JOBS, company_hint="Umbrella", subject="Hello")
            is None
        )
