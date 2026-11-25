"""Spec 028 step 1: what an email MEANS. Anonymized shapes of real mail that
was misread (invented names; wording kept to the pattern that mattered)."""

from app.services.email_classify import (
    APPLIED,
    INTERVIEW,
    RECRUITER,
    REJECTED,
    UNKNOWN,
    classify,
)
from app.services.email_templates import read_template


def kind(subject, text, sender="careers@quillfeather.example", **kw):
    return classify(subject, text, sender, **kw).event


class TestRejectionsReadRight:
    def test_informal_agency_rejection(self):
        text = (
            "Hi Sam, Thank you so much for applying to the Endpoint Engineer "
            "position. We really enjoyed reviewing your background. At this time, "
            "the client does need experience with ToolOne and ToolTwo for software "
            "deployment. That said, I'd love to keep your information on hand for "
            "future opportunities that might be a better fit. I wish you the very "
            "best in your job search. Thanks, Jo Rivers | Senior Talent Connector"
        )
        assert (
            kind("Application to Endpoint Engineer", text, "jo@brightlink.example")
            == REJECTED
        )

    def test_rejection_with_a_friendly_open_to_future_line(self):
        text = (
            "Our team has reviewed your resume and qualifications, and at this time, "
            "we've decided to move forward with other candidates for this role. We "
            "hope you are open to exploring opportunities with us in the future."
        )
        assert kind("Thanks for your time", text) == REJECTED

    def test_hard_wrapped_rejection(self):
        text = (
            "After careful review of the applications, we have determined that other candidates\n"
            "better meet the current needs of our organization for this position."
        )
        assert kind("Your Application with Kestrel Optics", text) == REJECTED

    def test_not_among_those_selected(self):
        text = (
            "Thank you for applying. Unfortunately, you were not among those "
            "selected for further consideration."
        )
        assert kind("Application status update", text) == REJECTED

    def test_plain_rejection_still_rejection(self):
        text = "We regret to inform you that we will not be moving forward with your application."
        assert kind("Your application", text) == REJECTED


class TestReceiptsAreNotOutcomes:
    def test_will_be_scheduling_interviews_is_not_a_rejection(self):
        text = (
            "Thank you for applying! We have received your application. Our team "
            "will be scheduling interviews over the next two weeks."
        )
        assert kind("Thank you for applying", text) == APPLIED

    def test_only_candidates_whose_experience_matches_will_be_contacted(self):
        text = (
            "We have received your application. Only candidates whose experience "
            "most closely matches the role will be contacted."
        )
        assert kind("We received your application", text) == APPLIED

    def test_receipt_with_a_bot_screen_next_step(self):
        text = (
            "Good news, we've received your application. After reviewing your "
            "background, we would like to schedule a brief conversation with a "
            "virtual recruiter to learn more about your qualifications."
        )
        subject = (
            "APPLICATION RECEIVED for the Endpoint Engineer role - Next Steps Enclosed"
        )
        assert kind(subject, text, "donotreply@botscreen.example") == APPLIED

    def test_receipt_listing_possible_steps(self):
        text = (
            "Your application has been received by Harbor County for the IT "
            "Administrator position. The selection process may include one or "
            "more of the following: application review, performance test, written "
            "test and/or oral interview examination."
        )
        assert kind("Application received by Harbor County", text) == APPLIED

    def test_real_invite_after_a_receipt_line_is_still_an_interview(self):
        text = (
            "Thank you for your interest in employment with Copper Kettle. Would you "
            "be available for a brief phone interview to discuss the role? You may "
            "select an interview time using the link below."
        )
        assert kind("Let's chat! - Copper Kettle", text) == INTERVIEW

    def test_we_are_reviewing_your_skills_is_a_receipt(self):
        text = (
            "Thank you for your interest in Vellacor and the Analyst role. We are "
            "reviewing your skills and experience and will notify you of next steps."
        )
        assert kind("Thank you for applying to Vellacor", text) == APPLIED


class TestNotHiringMail:
    def test_credit_limit_offer(self):
        text = (
            "A card unlike any other. Preview your new credit limit offer. Apply "
            "now. Your application won't affect your credit score. Unsubscribe"
        )
        assert (
            kind(
                "Your credit limit offer is ready", text, "card@bank.example", bulk=True
            )
            == UNKNOWN
        )

    def test_store_coupon_your_offer(self):
        text = (
            "Your offer is available in store and online with any $20 purchase. "
            "Apply at checkout. Unsubscribe"
        )
        assert kind("Free sandwich", text, "rewards@deli.example", bulk=True) == UNKNOWN

    def test_newsletter_mentioning_your_offer(self):
        text = "Newsletter. Job openings at big firms rose. Claim your offer today."
        assert kind("Morning news", text, "crew@news.example", bulk=True) == UNKNOWN

    def test_verification_code_from_a_saved_company(self):
        text = (
            "Your verification code is 123456. If you did not request this, ignore it."
        )
        assert (
            kind(
                "Verify your email address",
                text,
                "hr@copperkettle.example",
                job_sender=True,
            )
            == UNKNOWN
        )

    def test_account_created(self):
        text = "Welcome! Your careers profile is ready. Explore open roles."
        assert (
            kind(
                "Welcome - Thanks for creating a Vellacor Careers profile!",
                text,
                "TalentAcquisition@vellacor.example",
            )
            == UNKNOWN
        )

    def test_candidate_experience_survey(self):
        text = (
            "Thank you for applying for a role with us! To create the best candidate "
            "experience, please take two minutes to tell us about your application "
            "experience. Unsubscribe"
        )
        assert (
            kind(
                "Tell us about your application experience!",
                text,
                "noreply@survey.example",
                bulk=True,
            )
            == UNKNOWN
        )

    def test_did_you_hear_back(self):
        text = "You recently considered a Software Engineer role. Did you hear back about your application? No Yes"
        assert (
            kind(
                "Did you hear back from Vellacor?",
                text,
                "noreply@reviews.example",
                bulk=True,
            )
            == UNKNOWN
        )


class TestRecruiters:
    def test_agency_submitted_you(self):
        text = (
            "Thanks Sam! I wanted to confirm that you have been submitted to Acme "
            "for the Support Specialist position. I'll keep you posted! Best, Jo "
            "Rivers Technical Recruiter Northgate Staffing"
        )
        assert (
            kind("Re: Support Specialist (Acme)", text, "jo@northgate.example")
            == RECRUITER
        )

    def test_recruiter_signature_after_a_call(self):
        text = (
            "Hi Sam, It was a pleasure speaking with you today! Below are the topics "
            "most relevant to this position. Jo Rivers Technical Recruiter Northgate Staffing"
        )
        assert (
            kind("Support Specialist (Acme | Topics)", text, "jo@northgate.example")
            == RECRUITER
        )


class TestTemplates:
    def test_indeed_recruiter_message(self):
        t = read_template(
            "Let Northgate Staffing know you are interested",
            '"Jo Rivers" <no-reply@indeed.com>',
            "Hi Sam, I came across your profile. JOB DETAILS Job Title: Support "
            "Specialist Company: Northgate Staffing JOB DESCRIPTION: ...",
        )
        assert (t.company, t.title, t.event) == (
            "Northgate Staffing",
            "Support Specialist",
            RECRUITER,
        )

    def test_indeed_new_interview_times(self):
        t = read_template(
            "You requested new interview times from Copper Kettle LLC.",
            '"Indeed" <no-reply@indeed.com>',
            "New times suggested.",
        )
        assert (t.company, t.event) == ("Copper Kettle LLC", INTERVIEW)

    def test_linkedin_viewed(self):
        t = read_template(
            "Your application was viewed by Vellacor, Inc.",
            "LinkedIn <jobs-noreply@linkedin.com>",
            "",
        )
        assert (t.company, t.event) == ("Vellacor, Inc", APPLIED)


class TestReceiptRulesStayNarrow:
    """Spec 028 review: the receipt and not-hiring rules must not swallow real
    news that shares their wording."""

    def test_reply_on_a_receipt_thread_with_an_invite_is_an_interview(self):
        text = (
            "Hi Sam, thanks for applying. We'd like to invite you to an interview "
            "for the Support Engineer role. Are you free Tuesday afternoon?\n\n"
            "Jo Rivers\nTechnical Recruiter"
        )
        subject = "RE: Thank you for applying to Kestrel Optics"
        assert kind(subject, text, "jo.rivers@kestreloptics.example") == INTERVIEW

    def test_rejection_that_restates_the_receipt_is_a_rejection(self):
        text = (
            "Your application for the Support Engineer position has been received "
            "and reviewed. Unfortunately, we will not be moving forward with your "
            "application at this time."
        )
        assert kind("Thank you for your application", text) == REJECTED

    def test_receipt_explaining_each_status_is_not_a_rejection(self):
        text = (
            "We have received your application for Analyst. Here is a quick "
            "overview of the application statuses.\n\nReceived: your application "
            "was successfully received.\n\nNot Selected: We will not be moving "
            "forward with your application."
        )
        assert kind("We've received your application!", text) != REJECTED

    def test_receipt_ending_with_a_survey_link_is_still_a_receipt(self):
        text = (
            "Thank you for applying to Kestrel Optics. Your application has been "
            "received and our team will review your qualifications. We'd love your "
            "feedback: take a short survey about your candidate experience."
        )
        assert kind("Application received - Support Engineer", text) == APPLIED

    def test_a_date_in_april_is_not_a_card_rate(self):
        text = (
            "Thank you for applying to Kestrel Optics. Your application was "
            "submitted on Apr 3, 2026 and our team will review your qualifications."
        )
        assert kind("Application received", text, bulk=True) == APPLIED

    def test_a_purchasing_job_is_not_a_shopping_offer(self):
        text = (
            "Thank you for applying for the Purchase Order Specialist position. "
            "Your application has been received."
        )
        assert kind("Application received", text, bulk=True) == APPLIED
