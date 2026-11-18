"""Public-style examples, written independently of the synthetic templates.

Each is a short paraphrase of phrasing that is common in real hiring mail
(career-site sample letters, ATS defaults, recruiter outreach) or in the
non-job mail a personal inbox gets. Names and domains are fictional. These are
a second check that the rules are general, not tuned to the generator.
"""

import pytest

from app.services.email_classify import (
    APPLIED,
    ASSESSMENT,
    INTERVIEW,
    OFFER,
    RECRUITER,
    REJECTED,
    UNKNOWN,
    UNSURE,
    classify,
)
from app.services.email_match import sender_is_saved_company

HR = "Rowan Ellery <rowan.ellery@vellacor.example>"
ATS = "Vellacor Careers <no-reply@vellacor.example>"

EXAMPLES = [
    # ---------------------------------------------------------------- receipts
    (
        "receipt-1",
        APPLIED,
        "Application confirmation",
        "Thank you for submitting your application for the Support Engineer role. "
        "Our recruiting team will review your qualifications.",
        ATS,
    ),
    (
        "receipt-2",
        APPLIED,
        "We got it!",
        "This is to confirm that we have received your application. You can track "
        "its status in your candidate portal.",
        ATS,
    ),
    (
        "receipt-3",
        APPLIED,
        "Your application to Vellacor",
        "Hi Dana, thanks for applying! If your experience is a match for the "
        "position, a recruiter will reach out to schedule a call.",
        ATS,
    ),
    # -------------------------------------------------------------- rejections
    (
        "reject-1",
        REJECTED,
        "Your application",
        "We appreciate the time you invested in applying. After reviewing your "
        "background, we have decided to pursue other candidates.",
        ATS,
    ),
    (
        "reject-2",
        REJECTED,
        "Update regarding the Analyst position",
        "While your experience is impressive, we will not be moving forward with "
        "your candidacy at this time.",
        ATS,
    ),
    (
        "reject-3",
        REJECTED,
        "Thank you for interviewing",
        "Thank you for taking the time to meet with the team. We have decided to "
        "offer the role to another candidate.",
        HR,
    ),
    (
        "reject-4",
        REJECTED,
        "Application status",
        "We wanted to let you know that the requisition has been cancelled and "
        "we are no longer hiring for this position.",
        ATS,
    ),
    (
        "reject-5",
        REJECTED,
        "Your candidacy",
        "This was a difficult decision, but you were not selected for the next "
        "round. We will keep your resume on file for future openings.",
        ATS,
    ),
    (
        "reject-6",
        REJECTED,
        "Following up",
        "Unfortunately, the hiring team has decided not to proceed with your "
        "application.",
        HR,
    ),
    # -------------------------------------------------------------- interviews
    (
        "interview-1",
        INTERVIEW,
        "Next steps",
        "The hiring manager would like to speak with you. Could you let me know "
        "your availability for a 45 minute video interview next week?",
        HR,
    ),
    (
        "interview-2",
        INTERVIEW,
        "Congratulations - next round",
        "You've been selected to advance to the next stage of our process. "
        "Please book a time using the link below.",
        ATS,
    ),
    (
        "interview-3",
        INTERVIEW,
        "Onsite details",
        "Your onsite interview is confirmed for Thursday at 10am. Please bring a "
        "photo ID.",
        HR,
    ),
    (
        "interview-4",
        INTERVIEW,
        "Change of plans",
        "I'm so sorry, but I have to reschedule our call. Are you free on Monday "
        "afternoon instead?",
        HR,
    ),
    # ------------------------------------------------------------- assessments
    (
        "assess-1",
        ASSESSMENT,
        "Skills assessment",
        "As the next step in our hiring process, please complete the online "
        "assessment within 72 hours.",
        ATS,
    ),
    (
        "assess-2",
        ASSESSMENT,
        "Coding exercise",
        "We'd like you to work on a short technical exercise. You'll receive the "
        "assessment link in a separate email.",
        HR,
    ),
    # ------------------------------------------------------------------ offers
    (
        "offer-1",
        OFFER,
        "Your offer from Vellacor",
        "On behalf of the team, I am thrilled to extend you an offer to join "
        "Vellacor as a Data Engineer. The offer letter is attached.",
        HR,
    ),
    (
        "offer-2",
        OFFER,
        "Welcome aboard!",
        "We're excited to have you join the team. Please sign and return your "
        "offer letter by Friday.",
        HR,
    ),
    # --------------------------------------------------------------- recruiter
    (
        "recruiter-1",
        RECRUITER,
        "Quick question",
        "I came across your profile and think your background could be a great "
        "fit for a client of mine. Would you be open to a call?",
        "Mara Quist <mara@quiststaffing.example>",
    ),
    (
        "recruiter-2",
        RECRUITER,
        "Introduction",
        "I'm the technical recruiter for this search and wanted to introduce "
        "myself as your point of contact.",
        HR,
    ),
    # -------------------------------------------------------- not job mail
    (
        "not-job-1",
        UNKNOWN,
        "Your package is on its way",
        "Good news! Your order has shipped and will arrive Tuesday.",
        "Parcelly <orders@parcelly.example>",
    ),
    (
        "not-job-2",
        UNKNOWN,
        "Weekend sale",
        "Unfortunately all good things end - this sale ends Sunday. Shop now and "
        "save 20% off. Unsubscribe.",
        "Brightwick <deals@brightwick.example>",
    ),
    (
        "not-job-3",
        UNKNOWN,
        "Top career tips",
        "In this issue: how to prepare for a phone interview, and what to do "
        "after a job offer. Manage preferences | Unsubscribe",
        "Career Digest <news@careerdigest.example>",
    ),
    (
        "not-job-4",
        UNKNOWN,
        "Jobs you may be interested in",
        "Software Engineer at Brightwick. Product Designer at Parcelly. See all jobs.",
        "JobBoard <alerts@jobboard.example>",
    ),
    (
        "not-job-5",
        UNKNOWN,
        "Dinner Saturday?",
        "Want to grab dinner Saturday? Let me know what times work for you.",
        "Sam <sam.friend@mail.example>",
    ),
    (
        "not-job-6",
        UNKNOWN,
        "Your statement is ready",
        "Your monthly statement is now available. Sign in to view it.",
        "Bank <notifications@bank.example>",
    ),
    (
        "not-job-7",
        UNKNOWN,
        "Meeting notes",
        "Thanks everyone. Let's schedule a call next week to review the budget.",
        "Lee <lee@club.example>",
    ),
    # ------------------------------------------------------- tricky polarity
    (
        "tricky-1",
        INTERVIEW,
        "Good news",
        "We have decided to move forward with your application and would like to "
        "set up a phone screen.",
        HR,
    ),
    (
        "tricky-2",
        APPLIED,
        "Application received",
        "Thanks for applying. Please note we are unable to respond to every "
        "applicant individually.",
        ATS,
    ),
    (
        "tricky-3",
        REJECTED,
        "Re: Interview",
        "Thank you for your time on the phone screen. Unfortunately we won't be "
        "moving forward.",
        HR,
    ),
    (
        "tricky-4",
        OFFER,
        "Verbal offer follow-up",
        "As discussed, we're delighted to offer you the position. Base salary and "
        "start date details are below.",
        HR,
    ),
    # A person following up about "the role" with nothing else is a contact
    # (no card move either way).
    (
        "contact-1",
        RECRUITER,
        "Checking in",
        "Hope you're well! Wanted to follow up about the role - let's talk soon.",
        HR,
    ),
    # ------------------------------------------------------- should be unsure
    (
        "unsure-1",
        UNSURE,
        "Application update",
        "There's an update on your application. Please sign in to the candidate "
        "portal to view it.",
        ATS,
    ),
]

# Known gaps, pinned so a later fix has to remove the marker. (interview-4 —
# a reschedule with no job words — is fixed by Phase 5: the sender's domain
# names a saved company, which the scan passes to the classifier.)
_GAPS: dict[str, str] = {}

# The user's saved jobs, as the scan would know them.
SAVED = [{"id": "v1", "company": "Vellacor", "title": "Data Engineer"}]


def _param(i, e, s, b, f):
    marks = (
        [pytest.mark.xfail(strict=True, reason=f"known gap: {_GAPS[i]}")]
        if i in _GAPS
        else []
    )
    return pytest.param(s, b, f, e, id=i, marks=marks)


@pytest.mark.parametrize(
    "subject,body,sender,expected", [_param(*ex) for ex in EXAMPLES]
)
def test_public_example(subject, body, sender, expected):
    job_sender = sender_is_saved_company(SAVED, sender)
    assert classify(subject, body, sender, job_sender=job_sender).event == expected
