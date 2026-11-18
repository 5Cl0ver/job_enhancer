"""Seeded, repeatable synthetic job-email corpus for scoring the email pipeline.

Every email is built from a template and carries its ground truth: the expected
event type, the expected saved job (or None) and the template/family it came
from. Companies, people and employer domains are fictional (employer mail comes
from reserved ``.example`` domains); only the hiring-platform relay domains are
real, because treating them as employers is one of the bugs being measured.

The corpus is rendered to raw RFC822 bytes, so it exercises the real parser too:
HTML-only multiparts, hidden preheaders, zero-width characters, unknown or
mislabeled charsets, quoted reply history.

Synthetic scores only show the code handles *these* known cases. They are not a
measure of accuracy on real recruiter email.

Usage::

    emails = generate(n=1000, seed=1337)
    dev, holdout = split(emails, seed=1337)
"""

from __future__ import annotations

import base64
import html
import random
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.header import Header
from email.utils import format_datetime, formataddr

from evals.email_pipeline import (
    APPLIED,
    ASSESSMENT,
    EXPECTED_STAGE,
    INTERVIEW,
    OFFER,
    RECRUITER,
    REJECTED,
    UNKNOWN,
)

DEFAULT_SEED = 1337
DEFAULT_N = 1000


# --------------------------------------------------------------------------- #
# The fictional user's saved jobs (the matcher's candidates)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class SavedJob:
    key: str
    company: str
    title: str
    domain: str  # employer mail domain (reserved .example TLD)


SAVED_JOBS: tuple[SavedJob, ...] = (
    # Three roles at one company — the matcher must pick the right one.
    SavedJob("J01", "Quillfeather Labs", "Backend Engineer", "quillfeather.example"),
    SavedJob("J02", "Quillfeather Labs", "Frontend Engineer", "quillfeather.example"),
    SavedJob(
        "J03", "Quillfeather Labs", "Senior Data Engineer", "quillfeather.example"
    ),
    SavedJob("J04", "Brambleworks", "Full Stack Developer", "brambleworks.example"),
    SavedJob("J05", "Tidelock Systems", "Platform Engineer", "tidelock.example"),
    # Starts with "the" — one shared common word must not make a match.
    SavedJob(
        "J06", "The Copper Kettle Group", "Software Engineer", "copperkettle.example"
    ),
    SavedJob("J07", "Marrowfield Health", "React Developer", "marrowfield.example"),
    SavedJob("J08", "Orbweaver Analytics", "Data Analyst", "orbweaver.example"),
    SavedJob("J09", "Saltmarsh Logistics", "DevOps Engineer", "saltmarsh.example"),
    SavedJob("J10", "Kestrel & Finch", "Junior Web Developer", "kestrelfinch.example"),
    SavedJob("J11", "Vantorra Bank", "Software Engineer II", "vantorra.example"),
    SavedJob("J12", "Lumenhollow", "QA Automation Engineer", "lumenhollow.example"),
    SavedJob("J13", "Driftwood Games", "Gameplay Programmer", "driftwoodgames.example"),
    SavedJob("J14", "Pebblestone Insurance", "Python Developer", "pebblestone.example"),
)
_BY_KEY = {j.key: j for j in SAVED_JOBS}
_MULTI_ROLE = ("J01", "J02", "J03")

# Companies the user never saved (outreach, newsletters, vendors).
_OTHER_COMPANIES = ("Glimmerforge", "Hollowreed Media", "Ferncastle Retail", "Yarrowby")


def saved_jobs_as_dicts() -> list[dict]:
    """The saved jobs in the shape ``email_match.match_job`` takes."""
    return [{"id": j.key, "company": j.company, "title": j.title} for j in SAVED_JOBS]


# --------------------------------------------------------------------------- #
# Corpus records
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class SyntheticEmail:
    id: str
    template_id: str
    family: str  # near-identical templates share one; splits keep it whole
    expected_event: str
    expected_job: str | None
    raw: bytes
    tags: tuple[str, ...] = ()
    # Stage the card should move to, or None for "no card change" (recruiter,
    # unknown, and reminders about a stage the card has already reached).
    expected_action: str | None = None


@dataclass
class Draft:
    """What a template produces, before rendering to RFC822 bytes."""

    from_name: str
    from_addr: str
    subject: str
    text: str | None = None
    html: str | None = None
    # plain | alt (text+html) | html (single part) | html_mixed (html +
    # attachment, no text part) | html_alt_only (alternative with only html)
    layout: str = "plain"
    charset: str = "utf-8"  # declared charset of the text part
    codec: str | None = None  # codec actually used, when it differs (mislabels)


@dataclass
class Ctx:
    rng: random.Random
    job: SavedJob
    first: str  # sender's first name
    last: str
    candidate: str
    when: datetime

    def pick(self, *options: str) -> str:
        return self.rng.choice(options)

    @property
    def slug(self) -> str:
        return self.job.domain.split(".")[0]

    def greet(self) -> str:
        return self.pick("Hi {n},", "Hello {n},", "Dear {n},", "{n},").format(
            n=self.candidate
        )

    def signoff(self, team: bool = False) -> str:
        if team or self.rng.random() < 0.4:
            return self.pick(
                f"The {self.job.company} Talent Team",
                f"{self.job.company} Recruiting",
                f"Best regards,\n{self.job.company} Hiring Team",
            )
        return (
            f"{self.pick('Best', 'Thanks', 'Kind regards', 'Cheers')},\n"
            f"{self.first} {self.last}\n"
            f"{self.pick('Technical Recruiter', 'Talent Partner', 'Hiring Manager')}"
            f", {self.job.company}"
        )

    def day(self, offset: int = 2) -> str:
        return (self.when + timedelta(days=offset)).strftime("%A, %B %d")

    def employer(self, local: str | None = None) -> tuple[str, str]:
        local = local or self.pick("careers", "talent", "recruiting", "jobs", "hr")
        return (f"{self.job.company} Careers", f"{local}@{self.job.domain}")

    def person(self) -> tuple[str, str]:
        return (
            f"{self.first} {self.last}",
            f"{self.first.lower()}.{self.last.lower()}@{self.job.domain}",
        )


@dataclass(frozen=True)
class Template:
    id: str
    family: str
    event: str
    build: Callable[[Ctx], Draft]
    job: str = "saved"  # "saved" → expected job is ctx.job; "none" → None
    pool: tuple[str, ...] | None = None  # restrict which saved jobs it uses
    tags: tuple[str, ...] = field(default=())
    action: str = "auto"  # "auto" → the event's stage; "none" → no card change

    @property
    def expected_action(self) -> str | None:
        return None if self.action == "none" else EXPECTED_STAGE.get(self.event)


TEMPLATES: list[Template] = []


def template(
    id: str,
    family: str,
    event: str,
    *,
    job: str = "saved",
    pool: tuple[str, ...] | None = None,
    tags: tuple[str, ...] = (),
    action: str = "auto",
):
    def register(fn: Callable[[Ctx], Draft]) -> Callable[[Ctx], Draft]:
        TEMPLATES.append(Template(id, family, event, fn, job, pool, tags, action))
        return fn

    return register


# Hiring-platform relays: (display-name pattern, address pattern).
_PLATFORMS = {
    "greenhouse": ("{company}", "no-reply@us.greenhouse-mail.io"),
    "lever": ("{company}", "no-reply@hire.lever.co"),
    "workday": ("{company} Careers", "{slug}@myworkday.com"),
    "workdayjobs": ("{company} Careers", "no-reply@myworkdayjobs.com"),
    "indeed": ("Indeed Apply", "indeedapply@indeedemail.com"),
    "workable": ("{company}", "noreply@workablemail.com"),
    "taleo": ("{company}", "no-reply@taleo.net"),
    "icims": ("{company}", "{slug}@talent.icims.com"),
    "smartrecruiters": ("{company}", "noreply@smartrecruiters.com"),
    "ashby": ("{company} Recruiting", "no-reply@ashbyhq.com"),
}


def _platform(ctx: Ctx, name: str) -> tuple[str, str]:
    disp, addr = _PLATFORMS[name]
    return disp.format(company=ctx.job.company), addr.format(slug=ctx.slug)


def _quote(text: str, ctx: Ctx, offset: int = -5) -> str:
    """Render older mail as a quoted reply block."""
    date = (ctx.when + timedelta(days=offset)).strftime("%a, %b %d, %Y")
    quoted = "\n".join(f"> {line}" if line else ">" for line in text.splitlines())
    return f"On {date}, {ctx.first} {ctx.last} wrote:\n{quoted}"


# =========================================================================== #
# APPLIED
# =========================================================================== #
@template("app.direct.received", "app_receipt_direct", APPLIED)
def _(c: Ctx) -> Draft:
    name, addr = c.employer(c.pick("careers", "no-reply", "jobs"))
    return Draft(
        name,
        addr,
        c.pick(
            f"We received your application for {c.job.title}",
            f"Application received - {c.job.title}",
        ),
        f"{c.greet()}\n\nThank you for applying to the {c.job.title} position at "
        f"{c.job.company}. We have received your application and our team will "
        f"review it shortly.\n\n{c.signoff(team=True)}",
        layout=c.pick("plain", "alt"),
    )


@template("app.direct.thanks", "app_receipt_direct", APPLIED)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("no-reply")
    return Draft(
        name,
        addr,
        f"Thank you for applying to {c.job.company}",
        f"{c.greet()}\n\nThanks for applying! Your application for the "
        f"{c.job.title} role has been received. If your background is a match, "
        f"someone will reach out.\n\n{c.signoff(team=True)}",
        layout=c.pick("plain", "alt"),
    )


@template("app.greenhouse", "app_greenhouse", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, "greenhouse")
    return Draft(
        name,
        addr,
        f"Thank you for applying to {c.job.company}",
        f"{c.greet()}\n\nThanks for your interest in {c.job.company}! We received "
        f"your application for {c.job.title} and will be reviewing it soon.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template("app.lever", "app_lever", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, "lever")
    return Draft(
        name,
        addr,
        f"Thank you for your application to {c.job.company}",
        f"{c.greet()}\n\nThank you for your application to the {c.job.title} "
        f"team. We'll be in touch if your skills match our needs.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template("app.workday", "app_workday", APPLIED, tags=("platform", "html_only"))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("workday", "workdayjobs"))
    return Draft(
        name,
        addr,
        "Application Received",
        f"{c.greet()}\n\nThank you for your interest in {c.job.company}. Your "
        f"application for {c.job.title} (Job ID R-{c.rng.randint(10000, 99999)}) "
        f"was submitted successfully.\n\nYou can check the status of your "
        f"application in your candidate home.\n\n{c.signoff(team=True)}",
        layout="html_mixed",
    )


@template("app.indeed", "app_indeed", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, "indeed")
    return Draft(
        name,
        addr,
        f"Indeed Application: {c.job.title}",
        f"Your application has been submitted.\n\n{c.job.title}\n{c.job.company}"
        f" - Remote\n\nGood luck, {c.candidate}! The employer will contact you "
        "directly if they are interested.",
        layout="alt",
    )


@template("app.workable", "app_workable", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, "workable")
    return Draft(
        name,
        addr,
        f"Thanks for applying to {c.job.company}",
        f"{c.greet()}\n\nThanks for applying for the {c.job.title} position. "
        f"We've received your application and will review it as soon as "
        f"possible.\n\n{c.signoff(team=True)}",
        layout="alt",
    )


@template("app.taleo", "app_taleo", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, "taleo")
    return Draft(
        name,
        addr,
        f"{c.job.company} - Application Confirmation - {c.job.title}",
        f"{c.greet()}\n\nWe have received your application for the position of "
        f"{c.job.title}. Please do not reply to this message.\n\n"
        f"{c.signoff(team=True)}",
        layout="plain",
    )


@template("app.icims", "app_icims", APPLIED, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("icims", "smartrecruiters", "ashby"))
    return Draft(
        name,
        addr,
        c.pick("Your application", "Application confirmation"),
        f"{c.greet()}\n\nThis confirms we received your application for "
        f"{c.job.title} at {c.job.company}.\n\n{c.signoff(team=True)}",
        layout="alt",
    )


@template(
    "app.multirole.subject",
    "multirole_applied",
    APPLIED,
    pool=_MULTI_ROLE,
    tags=("multirole",),
)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("careers")
    return Draft(
        name,
        addr,
        f"Application received: {c.job.title}",
        f"{c.greet()}\n\nThank you for applying to {c.job.company}. Your "
        f"application for {c.job.title} has been received.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template(
    "app.multirole.body",
    "multirole_applied",
    APPLIED,
    pool=_MULTI_ROLE,
    tags=("multirole",),
)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("careers")
    return Draft(
        name,
        addr,
        f"Thank you for applying to {c.job.company}",
        f"{c.greet()}\n\nWe have received your application for the "
        f"{c.job.title} opening and will review it shortly.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template("app.zero_width", "app_hidden", APPLIED, tags=("hidden", "html_only"))
def _(c: Ctx) -> Draft:
    zw = "​"
    name, addr = c.employer("no-reply")
    return Draft(
        name,
        addr,
        f"Appli{zw}cation re{zw}ceived - {c.job.company}",
        html=(
            f"<html><body><p>{c.greet()}</p><p>Thank you for applying! Your "
            f"appli{zw}cation has been re{zw}ceived for the "
            f"<b>{html.escape(c.job.title)}</b> role at "
            f"{html.escape(c.job.company)}.</p></body></html>"
        ),
        layout="html",
    )


@template("app.bad_charset", "app_charset", APPLIED, tags=("charset",))
def _(c: Ctx) -> Draft:
    name, addr = c.employer("careers")
    return Draft(
        name,
        addr,
        f"Thank you for applying to {c.job.company}",
        f"{c.greet()}\n\nWe have received your application for {c.job.title}.\n\n"
        f"{c.signoff(team=True)}",
        layout=c.pick("plain", "alt"),
        charset=c.pick("x-unknown", "utf8mb4", "unknown-8bit"),
        codec="utf-8",
    )


# =========================================================================== #
# INTERVIEW
# =========================================================================== #
@template("int.invite", "int_invite", INTERVIEW)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        c.pick(
            f"Interview invitation - {c.job.title} at {c.job.company}",
            f"{c.job.company}: next steps for {c.job.title}",
        ),
        f"{c.greet()}\n\nThanks for applying for the {c.job.title} role. We'd like "
        f"to schedule an interview with you. Could you share your availability "
        f"for {c.day(3)} or {c.day(4)}?\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template("int.booking_link", "int_booking", INTERVIEW)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Let's find a time - {c.job.company}",
        f"{c.greet()}\n\nPlease use the link below to book a time for a 30 minute "
        f"chat about the {c.job.title} position:\n"
        f"https://scheduling.example/{c.slug}/{c.first.lower()}\n\n{c.signoff()}",
        layout="alt",
    )


@template(
    "int.move_forward.positive", "polarity_move_forward", INTERVIEW, tags=("polarity",)
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Update on your {c.job.company} application",
        f"{c.greet()}\n\nThank you for your patience. We have decided to move "
        f"forward with your application for {c.job.title} and would like to invite "
        f"you to a technical interview next week.\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template("int.reschedule", "int_reschedule", INTERVIEW, tags=("unfortunately",))
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Rescheduling our interview - {c.job.title}",
        f"{c.greet()}\n\nUnfortunately, something came up and I need to move our "
        f"interview on {c.day(1)}. Would {c.day(3)} at 2pm work instead?\n\n"
        f"{c.signoff()}",
        layout="plain",
    )


@template("int.reminder", "int_reminder", INTERVIEW, action="none", tags=("reminder",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("greenhouse", "ashby"))
    return Draft(
        name,
        addr,
        f"Reminder: your interview with {c.job.company} tomorrow",
        f"{c.greet()}\n\nThis is a reminder of your interview for {c.job.title} on "
        f"{c.day(1)} at 10:00 AM. The video link is in your calendar invite.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template("int.next_round", "int_next_round", INTERVIEW)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Next steps for your {c.job.title} application",
        f"{c.greet()}\n\nThe team enjoyed speaking with you and would like to "
        f"invite you to a final round with the engineering leads. Please reply "
        f"with a few times that suit you.\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template("int.phone_screen", "int_phone_screen", INTERVIEW)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"{c.job.title} - quick call?",
        f"{c.greet()}\n\nI'm reviewing applications for {c.job.title} and yours "
        f"stood out. Are you free for a 20 minute phone screen this week?\n\n"
        f"{c.signoff()}",
        layout="plain",
    )


@template("int.quoted_confirm", "int_quoted", INTERVIEW, tags=("quoted",))
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    old = (
        f"Thank you for applying to {c.job.company}. Unfortunately our hiring "
        f"manager is out this week, so it may take a little longer to respond."
    )
    return Draft(
        name,
        addr,
        f"Re: {c.job.title} at {c.job.company}",
        f"{c.greet()}\n\nGreat, {c.day(2)} at 2pm works. I've sent a calendar "
        f"invite for your interview with the team.\n\n{c.signoff()}\n\n"
        f"{_quote(old, c)}",
        layout="plain",
    )


@template("int.platform_confirm", "int_platform_confirm", INTERVIEW, tags=("platform",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("greenhouse", "lever", "ashby"))
    return Draft(
        name,
        addr,
        "Interview confirmation",
        f"{c.greet()}\n\nYour interview for {c.job.title} at {c.job.company} is "
        f"confirmed for {c.day(5)} at 1:30 PM.\n\n{c.signoff(team=True)}",
        layout="alt",
    )


@template(
    "int.multirole",
    "multirole_interview",
    INTERVIEW,
    pool=_MULTI_ROLE,
    tags=("multirole",),
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Interview for {c.job.title}",
        f"{c.greet()}\n\nWe'd like to schedule an interview for the {c.job.title} "
        f"position. What's your availability next week?\n\n{c.signoff()}",
        layout="alt",
    )


# =========================================================================== #
# ASSESSMENT
# =========================================================================== #
@template("asm.take_home", "asm_take_home", ASSESSMENT)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Next step: take-home assignment for {c.job.title}",
        f"{c.greet()}\n\nThanks for your time so far. The next step is a short "
        f"take-home assignment. Please complete it within five days and reply "
        f"with a link to your repository.\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template(
    "asm.online_platform", "asm_online", ASSESSMENT, tags=("platform", "html_only")
)
def _(c: Ctx) -> Draft:
    return Draft(
        "SkillGrid Assessments",
        "invites@skillgrid.example",
        f"{c.job.company} has invited you to an online assessment",
        f"{c.greet()}\n\n{c.job.company} has invited you to complete an online "
        f"assessment for the {c.job.title} role. The test takes about 90 minutes "
        f"and must be completed by {c.day(6)}.\n\nStart assessment: "
        f"https://skillgrid.example/t/{c.rng.randint(100000, 999999)}",
        layout="html_alt_only",
    )


@template("asm.coding_challenge", "asm_challenge", ASSESSMENT)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("recruiting")
    return Draft(
        name,
        addr,
        f"Coding challenge - {c.job.company}",
        f"{c.greet()}\n\nAs part of our process for {c.job.title}, we'd like you "
        f"to complete a coding challenge. You'll have 72 hours once you open the "
        f"link.\n\n{c.signoff(team=True)}",
        layout="alt",
    )


@template("asm.reminder", "asm_reminder", ASSESSMENT, action="none", tags=("reminder",))
def _(c: Ctx) -> Draft:
    return Draft(
        "SkillGrid Assessments",
        "reminders@skillgrid.example",
        f"Reminder: your {c.job.company} assessment expires soon",
        f"{c.greet()}\n\nYour assessment for {c.job.title} at {c.job.company} "
        f"expires on {c.day(1)}. You have not started it yet.",
        layout="alt",
    )


# =========================================================================== #
# OFFER
# =========================================================================== #
@template("off.letter", "polarity_offer", OFFER, tags=("polarity",))
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Offer of employment - {c.job.title}",
        f"{c.greet()}\n\nWe are delighted to offer you the {c.job.title} position "
        f"at {c.job.company}. Your offer letter is attached; please review it and "
        f"let us know by {c.day(7)}.\n\n{c.signoff()}",
        layout="alt",
    )


@template("off.congrats", "off_congrats", OFFER)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Congratulations from {c.job.company}!",
        f"{c.greet()}\n\nCongratulations! We're thrilled to extend you an offer "
        f"to join {c.job.company} as our new {c.job.title}. I'll call you "
        f"tomorrow to walk through the details.\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template("off.verbal_followup", "off_followup", OFFER)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Your offer details - {c.job.title}",
        f"{c.greet()}\n\nFollowing up on our call, here are the details of your "
        f"offer: base salary, start date, and benefits summary are below. Please "
        f"sign by {c.day(5)} if everything looks good.\n\n{c.signoff()}",
        layout="plain",
    )


# =========================================================================== #
# REJECTED
# =========================================================================== #
@template(
    "rej.move_forward.others",
    "polarity_move_forward",
    REJECTED,
    tags=("polarity", "baseline_hit"),
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Update on your {c.job.company} application",
        f"{c.greet()}\n\nThank you for your patience. We have decided to move "
        f"forward with other candidates for {c.job.title} whose experience more "
        f"closely matches our needs.\n\n{c.signoff()}",
        layout=c.pick("plain", "alt"),
    )


@template(
    "rej.other_applicants", "rej_other_applicants", REJECTED, tags=("baseline_miss",)
)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("no-reply")
    return Draft(
        name,
        addr,
        f"Your application for {c.job.title}",
        f"{c.greet()}\n\nAfter careful review, we are moving forward with other "
        f"applicants for the {c.job.title} role. We appreciate your interest in "
        f"{c.job.company}.\n\n{c.signoff(team=True)}",
        layout=c.pick("plain", "alt"),
    )


@template("rej.chosen_another", "rej_chosen_another", REJECTED, tags=("baseline_miss",))
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"{c.job.title} position",
        f"{c.greet()}\n\nThank you for interviewing with us. After a lot of "
        f"thought, we have chosen another candidate for the {c.job.title} "
        f"position.\n\n{c.signoff()}",
        layout="plain",
    )


@template("rej.not_a_fit", "rej_not_a_fit", REJECTED, tags=("baseline_miss",))
def _(c: Ctx) -> Draft:
    name, addr = c.employer("talent")
    return Draft(
        name,
        addr,
        f"Regarding your {c.job.company} application",
        f"{c.greet()}\n\nThanks for taking the time to apply. We've reviewed your "
        f"background and determined it's not a fit for the {c.job.title} role at "
        f"this time.\n\n{c.signoff(team=True)}",
        layout=c.pick("plain", "alt"),
    )


@template(
    "rej.position_closed", "rej_position_closed", REJECTED, tags=("baseline_miss",)
)
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("greenhouse", "lever", "workable"))
    return Draft(
        name,
        addr,
        f"Update: {c.job.title}",
        f"{c.greet()}\n\nWe wanted to let you know the {c.job.title} position has "
        f"been closed and we are no longer accepting candidates.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template("rej.regret", "rej_regret", REJECTED, tags=("baseline_hit",))
def _(c: Ctx) -> Draft:
    name, addr = c.employer("hr")
    return Draft(
        name,
        addr,
        f"{c.job.company} - {c.job.title}",
        f"{c.greet()}\n\nWe regret to inform you that we will not be proceeding "
        f"with your application for {c.job.title}.\n\n{c.signoff(team=True)}",
        layout="plain",
    )


@template("rej.not_selected", "rej_not_selected", REJECTED, tags=("baseline_hit",))
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("smartrecruiters", "icims", "taleo"))
    return Draft(
        name,
        addr,
        "An update on your application",
        f"{c.greet()}\n\nThank you for applying to {c.job.company}. You were not "
        f"selected to move forward for the {c.job.title} position.\n\n"
        f"{c.signoff(team=True)}",
        layout="alt",
    )


@template(
    "rej.workday",
    "rej_workday",
    REJECTED,
    tags=("platform", "html_only", "baseline_miss"),
)
def _(c: Ctx) -> Draft:
    name, addr = _platform(c, c.pick("workday", "workdayjobs"))
    return Draft(
        name,
        addr,
        "Update on your application",
        f"{c.greet()}\n\nUnfortunately, we will not be moving forward with your "
        f"application for {c.job.title} at {c.job.company}.\n\n"
        f"{c.signoff(team=True)}",
        layout="html_mixed",
    )


@template(
    "rej.quoted_after_interview",
    "rej_quoted",
    REJECTED,
    tags=("quoted", "baseline_hit"),
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    old = (
        f"Hi {c.candidate}, we'd like to schedule an interview for {c.job.title}. "
        f"What's your availability next week?"
    )
    return Draft(
        name,
        addr,
        f"Re: {c.job.title} at {c.job.company}",
        f"{c.greet()}\n\nThank you again for interviewing. The team has decided "
        f"not to move forward at this stage.\n\n{c.signoff()}\n\n{_quote(old, c)}",
        layout="plain",
    )


@template(
    "rej.unable_to_offer",
    "polarity_offer",
    REJECTED,
    tags=("polarity", "baseline_miss"),
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Your {c.job.title} application",
        f"{c.greet()}\n\nAfter much deliberation, we are not able to offer you the "
        f"{c.job.title} position at {c.job.company}.\n\n{c.signoff()}",
        layout="alt",
    )


@template(
    "rej.html_only", "rej_html_only", REJECTED, tags=("html_only", "baseline_miss")
)
def _(c: Ctx) -> Draft:
    name, addr = c.employer("no-reply")
    return Draft(
        name,
        addr,
        f"Your application to {c.job.company}",
        f"{c.greet()}\n\nThank you for your interest in the {c.job.title} role. "
        f"We regret to inform you that we won't be moving forward.\n\n"
        f"{c.signoff(team=True)}",
        layout=c.pick("html_mixed", "html_alt_only"),
    )


@template("rej.bad_charset", "rej_charset", REJECTED, tags=("charset", "baseline_miss"))
def _(c: Ctx) -> Draft:
    name, addr = c.employer("talent")
    return Draft(
        name,
        addr,
        f"{c.job.company} application update",
        f"{c.greet()}\n\nWe regret to inform you that the {c.job.title} position "
        f"has been filled.\n\n{c.signoff(team=True)}",
        layout="plain",
        charset=c.pick("x-unknown", "utf8mb4", "iso-8859-16x", "x-user-defined"),
        codec="utf-8",
    )


@template(
    "rej.smart_quotes",
    "rej_smart_quotes",
    REJECTED,
    tags=("charset", "baseline_miss"),
)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"{c.job.title} — update",
        f"{c.greet()}\n\nThank you for your time. We won’t be moving forward "
        f"with your candidacy for {c.job.title}.\n\n{c.signoff()}",
        layout="plain",
        # Correctly declared cp1252, or mislabeled us-ascii carrying UTF-8 bytes.
        **c.rng.choice(
            [
                {"charset": "windows-1252"},
                {"charset": "us-ascii", "codec": "utf-8"},
            ]
        ),
    )


# =========================================================================== #
# RECRUITER (a human contact, no stage move)
# =========================================================================== #
@template("rec.agency_outreach", "rec_agency", RECRUITER, job="none")
def _(c: Ctx) -> Draft:
    return Draft(
        f"{c.first} {c.last}",
        f"{c.first.lower()}@hollowreedtalent.example",
        c.pick(
            "Senior engineering opportunity - fintech client",
            "Quick question about your next role",
        ),
        f"{c.greet()}\n\nI came across your resume and think you'd be a strong "
        f"fit for a backend position with one of my clients. Would you be open to "
        f"hearing more?\n\n{c.first}\nHollowreed Talent Partners",
        layout="plain",
    )


@template("rec.inhouse_intro", "rec_inhouse", RECRUITER)
def _(c: Ctx) -> Draft:
    name, addr = c.person()
    return Draft(
        name,
        addr,
        f"Introduction - {c.job.title}",
        f"{c.greet()}\n\nI'm the recruiter supporting the {c.job.title} role at "
        f"{c.job.company} and I'll be your point of contact as your application "
        f"moves through our process.\n\n{c.signoff()}",
        layout="plain",
    )


@template("rec.linkedin_inmail", "rec_inmail", RECRUITER, job="none")
def _(c: Ctx) -> Draft:
    other = c.pick(*_OTHER_COMPANIES)
    return Draft(
        f"{c.first} {c.last} via LinkedIn",
        "inmail-hit-reply@linkedin.com",
        f"{c.first} sent you a message",
        f"{c.first} {c.last}, Talent Lead at {other}\n\n{c.greet()} I'm hiring "
        f"for a platform role on my team and your profile caught my eye. Open to "
        f"a chat?",
        layout="alt",
    )


# =========================================================================== #
# UNKNOWN (no job event — must not move or match a card)
# =========================================================================== #
@template("unk.indeed_alert", "unk_indeed_alert", UNKNOWN, job="none", tags=("alert",))
def _(c: Ctx) -> Draft:
    return Draft(
        "Indeed",
        "alert@indeed.com",
        f"{c.job.title} jobs near you",
        f"New jobs matching your search\n\n{c.job.title}\n{c.job.company} - "
        f"Remote\nEasily apply\n\n{c.job.title}\n{c.pick(*_OTHER_COMPANIES)} - "
        "Hybrid\n\nSee all positions",
        layout="alt",
    )


@template(
    "unk.linkedin_alert", "unk_linkedin_alert", UNKNOWN, job="none", tags=("alert",)
)
def _(c: Ctx) -> Draft:
    return Draft(
        "LinkedIn Job Alerts",
        "jobalerts-noreply@linkedin.com",
        f"{c.job.title} at {c.job.company} and 9 more jobs",
        f"Your job alert for {c.job.title}\n\n{c.job.company}\n{c.job.title}\n"
        f"Actively recruiting\n\nView all jobs",
        layout="alt",
    )


@template(
    "unk.newsletter_interview",
    "unk_newsletter_interview",
    UNKNOWN,
    job="none",
    tags=("newsletter",),
)
def _(c: Ctx) -> Draft:
    return Draft(
        "The Build Log",
        "newsletter@buildlog.example",
        c.pick(
            f"This week: an interview with the CTO of {c.job.company}",
            "Our interview with three staff engineers",
        ),
        f"In this issue: our interview with {c.first} {c.last} on scaling "
        f"engineering teams at {c.job.company}, plus five links worth your "
        "time.\n\nUnsubscribe | Manage preferences",
        layout="alt",
    )


@template(
    "unk.newsletter_tips",
    "unk_newsletter_tips",
    UNKNOWN,
    job="none",
    tags=("newsletter",),
)
def _(c: Ctx) -> Draft:
    return Draft(
        "Career Compass",
        "hello@careercompass.example",
        "5 ways to prepare for your next phone screen",
        "This week's guide covers how to schedule an interview prep routine, "
        "what to ask a recruiter, and how to share your availability without "
        "sounding desperate.\n\nUnsubscribe",
        layout="alt",
    )


@template(
    "unk.sales_unfortunately",
    "unk_sales",
    UNKNOWN,
    job="none",
    tags=("sales", "unfortunately"),
)
def _(c: Ctx) -> Draft:
    shop = c.pick(*_OTHER_COMPANIES)
    return Draft(
        shop,
        f"deals@{shop.split()[0].lower()}.example",
        c.pick("Last chance: 30% off ends tonight", "Your cart is waiting"),
        "Unfortunately, our autumn sale ends at midnight. Don't miss out on the "
        "items in your cart.\n\nShop now | Unsubscribe",
        layout="alt",
    )


@template("unk.sales_offer", "unk_sales", UNKNOWN, job="none", tags=("sales",))
def _(c: Ctx) -> Draft:
    shop = c.pick(*_OTHER_COMPANIES)
    return Draft(
        shop,
        f"offers@{shop.split()[0].lower()}.example",
        "An exclusive offer just for you",
        "We're delighted to offer you 40% off your next order. Congratulations, "
        "you've been selected for early access!\n\nUnsubscribe",
        layout="alt",
    )


@template("unk.order_receipt", "unk_receipt", UNKNOWN, job="none")
def _(c: Ctx) -> Draft:
    return Draft(
        "Ferncastle Retail",
        "orders@ferncastle.example",
        f"Your order #{c.rng.randint(100000, 999999)} has been received",
        f"{c.greet()}\n\nThanks for your order! We've received it and will email "
        "you when it ships.",
        layout="alt",
    )


@template(
    "unk.hidden_preheader",
    "unk_hidden_preheader",
    UNKNOWN,
    job="none",
    tags=("hidden", "html_only"),
)
def _(c: Ctx) -> Draft:
    hidden = "Book a time with our team to schedule your call." + ("‌ " * 40)
    return Draft(
        "Yarrowby Cloud",
        "news@yarrowby.example",
        "Your storage is almost full",
        html=(
            "<html><body>"
            '<div style="display:none;max-height:0;overflow:hidden;'
            f'mso-hide:all">{hidden}</div>'
            f"<p>{c.greet()}</p><p>You've used 95% of your storage. Upgrade to "
            "keep syncing your files.</p></body></html>"
        ),
        layout="html",
    )


@template("unk.vendor_call", "unk_vendor_call", UNKNOWN, job="none", tags=("sales",))
def _(c: Ctx) -> Draft:
    return Draft(
        "Glimmerforge Sales",
        "sales@glimmerforge.example",
        "Following up on your trial",
        f"{c.greet()}\n\nI'd like to schedule a call to walk your team through "
        f"the Pro plan. What's your availability this week?\n\nGlimmerforge",
        layout="plain",
    )


@template("unk.security_notice", "unk_security", UNKNOWN, job="none")
def _(c: Ctx) -> Draft:
    return Draft(
        "Yarrowby Accounts",
        "no-reply@yarrowby.example",
        "Your password was changed",
        f"{c.greet()}\n\nThe password for your account was changed on "
        f"{c.day(0)}. If this wasn't you, reset it now.",
        layout="alt",
    )


# --------------------------------------------------------------------------- #
# Rendering Draft → RFC822 bytes
# --------------------------------------------------------------------------- #
_CANDIDATES = ("Alex", "Sam", "Jamie", "Taylor", "Robin")
_FIRST = ("Priya", "Marcus", "Elena", "Tomasz", "Aiko", "Jordan", "Noor", "Mateo")
_LAST = ("Okafor", "Lindqvist", "Hartwell", "Moreau", "Castellanos", "Achterberg")
_BASE_DATE = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)
_PDF = base64.b64encode(b"%PDF-1.4\n% synthetic attachment\n").decode()


def _header(value: str) -> str:
    return value if value.isascii() else Header(value, "utf-8").encode()


def _text_to_html(text: str) -> str:
    paras = [
        html.escape(p).replace("\n", "<br>") for p in text.split("\n\n") if p.strip()
    ]
    body = "".join(f"<p>{p}</p>" for p in paras)
    return f'<html><body style="font-family:Arial">{body}</body></html>'


def _part(ctype: str, text: str, charset: str, codec: str | None = None) -> bytes:
    try:
        payload = text.encode(codec or charset)
    except LookupError:
        payload = text.encode("utf-8")
    head = (
        f'Content-Type: {ctype}; charset="{charset}"\r\n'
        "Content-Transfer-Encoding: 8bit\r\n\r\n"
    )
    return head.encode("ascii") + payload.replace(b"\n", b"\r\n")


def _multipart(subtype: str, boundary: str, parts: list[bytes]) -> bytes:
    out = f'Content-Type: multipart/{subtype}; boundary="{boundary}"\r\n\r\n'.encode()
    for p in parts:
        out += f"--{boundary}\r\n".encode() + p + b"\r\n"
    return out + f"--{boundary}--\r\n".encode()


def _attachment() -> bytes:
    return (
        b"Content-Type: application/pdf\r\n"
        b'Content-Disposition: attachment; filename="details.pdf"\r\n'
        b"Content-Transfer-Encoding: base64\r\n\r\n" + _PDF.encode() + b"\r\n"
    )


# Mailing-list mail: what real newsletters, alerts and shops send.
_LIST_TAGS = {"newsletter", "sales", "alert"}
_LIST_TEMPLATES = {"unk.order_receipt", "unk.hidden_preheader", "unk.security_notice"}
_AUTOMATED_LOCAL = re.compile(
    r"^(no-?reply|noreply|notifications?|alerts?|jobalerts-noreply|indeedapply|"
    r"invites|reminders|inmail-hit-reply)$"
)


def bulk_headers(template_id: str, tags: tuple[str, ...], from_addr: str) -> str:
    """Realistic list / automation headers, so the header filter is tested on
    mail that looks like bulk mail, including automated ATS mail it must keep."""
    out = ""
    domain = from_addr.rsplit("@", 1)[-1]
    if template_id in _LIST_TEMPLATES or _LIST_TAGS & set(tags):
        out += (
            f"List-Unsubscribe: <mailto:unsubscribe@{domain}>\r\nPrecedence: bulk\r\n"
        )
    if "platform" in tags or _AUTOMATED_LOCAL.match(from_addr.split("@", 1)[0]):
        out += "Auto-Submitted: auto-generated\r\n"
    return out


def render(
    d: Draft, *, message_id: str, date: datetime, extra_headers: str = ""
) -> bytes:
    headers = (
        f"From: {formataddr((d.from_name, d.from_addr))}\r\n"
        "To: Alex Candidate <alex.candidate@example.com>\r\n"
        f"Subject: {_header(d.subject)}\r\n"
        f"Date: {format_datetime(date)}\r\n"
        f"Message-ID: <{message_id}@synthetic.example>\r\n"
        "MIME-Version: 1.0\r\n" + extra_headers
    ).encode()
    text = d.text or ""
    markup = d.html or _text_to_html(text)
    if d.layout == "plain":
        body = _part("text/plain", text, d.charset, d.codec)
    elif d.layout == "html":
        body = _part("text/html", markup, "utf-8")
    elif d.layout == "alt":
        body = _multipart(
            "alternative",
            "ALT",
            [
                _part("text/plain", text, d.charset, d.codec),
                _part("text/html", markup, "utf-8"),
            ],
        )
    elif d.layout == "html_alt_only":
        body = _multipart("alternative", "ALT", [_part("text/html", markup, "utf-8")])
    elif d.layout == "html_mixed":
        body = _multipart(
            "mixed", "MIX", [_part("text/html", markup, "utf-8"), _attachment()]
        )
    else:
        raise ValueError(f"unknown layout {d.layout!r}")
    return headers + body


# --------------------------------------------------------------------------- #
# Generation + splitting
# --------------------------------------------------------------------------- #
def generate(n: int = DEFAULT_N, seed: int = DEFAULT_SEED) -> list[SyntheticEmail]:
    """Build ``n`` emails, cycling through every template. Same seed → same bytes."""
    rng = random.Random(seed)
    out: list[SyntheticEmail] = []
    for i in range(n):
        tpl = TEMPLATES[i % len(TEMPLATES)]
        keys = tpl.pool or tuple(_BY_KEY)
        ctx = Ctx(
            rng=rng,
            job=_BY_KEY[rng.choice(keys)],
            first=rng.choice(_FIRST),
            last=rng.choice(_LAST),
            candidate=rng.choice(_CANDIDATES),
            when=_BASE_DATE + timedelta(days=rng.randint(0, 60), minutes=i),
        )
        draft = tpl.build(ctx)
        eid = f"syn-{i:04d}"
        out.append(
            SyntheticEmail(
                id=eid,
                template_id=tpl.id,
                family=tpl.family,
                expected_event=tpl.event,
                expected_job=ctx.job.key if tpl.job == "saved" else None,
                raw=render(
                    draft,
                    message_id=eid,
                    date=ctx.when,
                    extra_headers=bulk_headers(tpl.id, tpl.tags, draft.from_addr),
                ),
                tags=tpl.tags,
                expected_action=tpl.expected_action,
            )
        )
    return out


def split(
    emails: list[SyntheticEmail],
    *,
    holdout_fraction: float = 0.25,
    seed: int = DEFAULT_SEED,
    restarts: int = 50,
    steps: int = 2000,
) -> tuple[list[SyntheticEmail], list[SyntheticEmail]]:
    """Split into (dev, holdout) by template *family*, never by email.

    Near-identical templates and polarity pairs share a family, so a phrasing
    seen while tuning rules on ``dev`` can't leak into ``holdout``. On top of
    that, every event label and every tag (charset, html_only, hidden, quoted,
    baseline_hit, baseline_miss, …) carried by two or more families must appear
    on BOTH sides, so each special case can be tuned on dev and checked on
    holdout. Found by a seeded search over family assignments: same seed, same
    split.
    """
    keys_of: dict[str, set[str]] = {}
    size: dict[str, int] = {}
    for e in emails:
        keys = keys_of.setdefault(e.family, set())
        keys.add(f"label:{e.expected_event}")
        keys.update(f"tag:{t}" for t in e.tags)
        size[e.family] = size.get(e.family, 0) + 1
    families = sorted(keys_of)
    holders: dict[str, list[str]] = {}
    for fam in families:
        for key in keys_of[fam]:
            holders.setdefault(key, []).append(fam)
    required = {k: fams for k, fams in holders.items() if len(fams) >= 2}
    lo, hi = holdout_fraction * 0.7, holdout_fraction * 1.3
    total = len(emails)

    def violated(held: set[str]) -> list[str]:
        return sorted(
            k
            for k, fams in required.items()
            if all(f in held for f in fams) or not any(f in held for f in fams)
        )

    # Seeded min-conflicts search: start from a random assignment and flip one
    # family at a time toward satisfying a violated key or the size target.
    rng = random.Random(seed)
    for _ in range(restarts):
        held = {f for f in families if rng.random() < holdout_fraction}
        for _ in range(steps):
            bad = violated(held)
            share = sum(size[f] for f in held) / total if total else 0
            if not bad and lo <= share <= hi:
                dev = [e for e in emails if e.family not in held]
                holdout = [e for e in emails if e.family in held]
                return dev, holdout
            if bad:
                held ^= {rng.choice(required[rng.choice(bad)])}
            elif share > hi:
                held.discard(rng.choice(sorted(held)))
            else:
                held.add(rng.choice(sorted(set(families) - held)))
    raise ValueError("no family split satisfies the balance constraints")
