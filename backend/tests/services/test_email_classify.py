"""Unit tests for the email → pipeline-signal classifier and job matcher."""

from app.services.email_classify import (
    APPLIED,
    INTERVIEW,
    REJECTED,
    UNKNOWN,
    classify_email,
    company_from_sender,
    stage_for_event,
)
from app.services.email_match import match_job


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
        # Company from the sender's own domain + the title in the subject.
        m = match_job(
            self.JOBS,
            subject="Backend Engineer application update",
            from_addr="careers@acme.example",
        )
        assert m.matched and m.job["id"] == "1" and m.evidence == "company_title"

    def test_company_alone_matches_its_only_job(self):
        m = match_job(self.JOBS, subject="Your application to Globex — thank you")
        assert m.matched and m.job["id"] == "2" and m.evidence == "company_date"

    def test_title_and_company_in_subject(self):
        m = match_job(
            self.JOBS, subject="Systems Administrator role at Initech — next steps"
        )
        assert m.matched and m.job["id"] == "3" and m.evidence == "company_title"

    def test_no_evidence_returns_none(self):
        m = match_job(self.JOBS, subject="Hello", from_addr="hi@umbrella.example")
        assert m.status == "none" and m.job is None


class TestEvidence:
    """Phase 4: gate, sentence-level cues, negation, conditions, unsure."""

    HR = "Rowan Ellery <rowan.ellery@vellacor.example>"

    def _c(self, subject, body, sender=None, **kw):
        from app.services.email_classify import classify

        return classify(subject, body, sender or self.HR, **kw)

    def test_negated_interview_cue_is_dropped(self):
        c = self._c(
            "Your application",
            "We will not be scheduling interviews for this role. We have filled "
            "the position.",
        )
        assert c.event == REJECTED

    def test_conditional_interview_is_not_an_invite(self):
        from app.services.email_classify import APPLIED as APP

        c = self._c(
            "Application received",
            "We received your application. If your experience matches, we will "
            "reach out to schedule an interview.",
        )
        assert c.event == APP

    def test_conflicting_outcomes_are_unsure(self):
        from app.services.email_classify import UNSURE

        c = self._c(
            "Update on your application",
            "We regret to inform you that the Data role is closed. We'd like to "
            "schedule an interview for the Analytics role instead.",
        )
        assert c.event == UNSURE and c.reason == "conflict"

    def test_weak_evidence_is_unsure(self):
        from app.services.email_classify import UNSURE

        c = self._c("Following up on the role", "We'd like to talk with you more.")
        assert c.event == UNSURE and c.reason == "weak"

    def test_rejection_beats_its_own_thank_you(self):
        c = self._c(
            "Thank you for applying",
            "Thank you for applying. After review, we have chosen another candidate.",
        )
        assert c.event == REJECTED

    def test_marketing_offer_is_not_a_job_offer(self):
        c = self._c(
            "An exclusive offer",
            "We're delighted to offer you 40% off your next order. Unsubscribe.",
            "Shop <offers@shop.example>",
        )
        assert c.event == UNKNOWN

    def test_bulk_headers_need_an_own_application_reference(self):
        body = "Five ways to schedule an interview prep routine this week."
        assert self._c("Career tips", body, bulk=True).event == UNKNOWN
        own = "Your interview is confirmed for Monday at 10am."
        assert self._c("Interview confirmation", own, bulk=True).event == INTERVIEW

    def test_job_alert_digest_is_unknown(self):
        c = self._c(
            "New jobs for you",
            "Data Analyst at Vellacor and 12 more jobs matching your search.",
            "Board <alerts@board.example>",
        )
        assert c.event == UNKNOWN and c.reason == "alert"

    def test_reminder_flag(self):
        c = self._c(
            "Reminder: your interview tomorrow",
            "This is a reminder of your interview with the team tomorrow at 10am.",
        )
        assert c.event == INTERVIEW and c.reminder

    def test_offer_and_assessment_map_to_stages(self):
        from app.services.email_classify import ASSESSMENT, OFFER

        assert stage_for_event(OFFER) == "Offer"
        assert stage_for_event(ASSESSMENT) == "Take-Home Assignment"
        assert stage_for_event("unsure") is None


class TestCardAction:
    ORDERS = {
        "Applied": 3,
        "Take-Home Assignment": 5,
        "Interview": 6,
        "Offer": 7,
        "Rejected": 8,
    }

    def _act(self, target, current, reminder=False):
        from app.services.email_scan import card_action

        return card_action(
            target, self.ORDERS, current_order=current, reminder=reminder
        )

    def test_forward_move_is_proposed(self):
        assert self._act("Interview", 3) == (True, "forward")
        assert self._act("Applied", None) == (True, "forward")

    def test_never_backward_or_sideways(self):
        assert self._act("Applied", 6) == (False, "already_at_or_past_stage")
        assert self._act("Interview", 6) == (False, "already_at_or_past_stage")
        assert self._act("Take-Home Assignment", 6)[0] is False

    def test_rejection_from_any_open_stage(self):
        assert self._act("Rejected", 7) == (True, "forward")
        assert self._act("Rejected", 8)[0] is False

    def test_reminder_never_moves(self):
        assert self._act("Interview", 3, reminder=True) == (False, "reminder")

    def test_deleted_stage_is_flagged(self):
        assert self._act("Phone Screen", 3) == (True, "stage_missing")
