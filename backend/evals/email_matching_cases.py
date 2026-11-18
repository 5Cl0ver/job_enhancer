"""Seeded stress cases for the job matcher — the hard shapes real mail takes.

The main synthetic corpus (:mod:`evals.email_synthetic`) mostly names both the
company and the title, which makes matching look easy. These cases are the
opposite: emails that omit the title, name only the company (in the text, the
display name, or just the sender's domain), or belong to one of several roles
at the same company. Fully synthetic — fictional companies, reserved
``.example`` domains, no real mail.

Each case says what a correct matcher must do: auto-match the one right job,
or ask for review with the right job among the candidates. It must never
auto-match a wrong job. Kept separate from the main corpus so its scorecard
baseline doesn't shift.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.services.email_match import (
    COMPANY_DATE,
    COMPANY_ONLY,
    COMPANY_TITLE,
    KNOWN_SENDER,
    MATCHED,
    REVIEW,
    SEVERAL_JOBS,
    SEVERAL_ROLES,
    TITLE_ONLY,
)
from evals.email_synthetic import SAVED_JOBS

DEFAULT_SEED = 4242
SAVED_AT = datetime(2026, 9, 1, tzinfo=UTC)

_BY_KEY = {j.key: j for j in SAVED_JOBS}
# Quillfeather Labs has three roles: J01 Backend, J02 Frontend, J03 Senior Data.
_MULTI = ("J01", "J02", "J03")
# Companies with exactly one saved role.
_SINGLE = ("J04", "J05", "J07", "J08", "J09", "J12", "J13", "J14")

_PEOPLE = ("Priya Okafor", "Rowan Ellery", "Maren Holt", "Tomas Vey", "Ines Laurent")
_RELAYS = ("notifications@ats-relay.example", "no-reply@applytrack.example")


def matching_jobs() -> list[dict]:
    """The saved jobs, as ``match_job`` takes them, all saved on SAVED_AT."""
    return [
        {"id": j.key, "company": j.company, "title": j.title, "saved_at": SAVED_AT}
        for j in SAVED_JOBS
    ]


@dataclass(frozen=True)
class MatchCase:
    id: str
    scenario: str
    subject: str
    from_addr: str
    text: str
    date: datetime
    expected_status: str  # matched | review
    expected_evidence: str
    expected_job: str  # the job it is really about
    # For review: the candidates the user must be offered (at least these).
    expected_candidates: frozenset[str] = frozenset()
    reply_to: str = ""
    # Approved history: address -> job keys (known-sender cases).
    known_senders: tuple[tuple[str, tuple[str, ...]], ...] = ()

    def known(self) -> dict[str, set]:
        return {a: set(ids) for a, ids in self.known_senders}


# Wording that never mentions a title. "{co}" is filled in only where the
# scenario lets the text name the company.
_NO_TITLE_BODIES = (
    "Thanks for your interest in {co}. We'd like to schedule an interview with "
    "you. What's your availability next week?",
    "Hi! I'm reaching out from {co} about your application. Could we set up a "
    "call to talk through next steps?",
    "Thank you for applying to {co}. Unfortunately, we have decided to move "
    "forward with other candidates.",
    "We received your application at {co} and our team is reviewing it now.",
)
_NO_COMPANY_BODIES = (
    "We'd like to schedule an interview with you. What's your availability?",
    "Thank you for applying. Unfortunately, we have decided not to move forward.",
    "We received your application and the hiring team is reviewing it.",
)
_SUBJECTS_NO_TITLE = (
    "Your application",
    "Next steps",
    "Following up",
    "Re: your application",
    "An update from {co}",
    "{co} — next steps",
)


def _person(rng: random.Random, domain: str) -> tuple[str, str]:
    name = rng.choice(_PEOPLE)
    local = name.split()[0].lower()
    return name, f"{name} <{local}@{domain}>"


def _date(rng: random.Random, *, before_saved: bool = False) -> datetime:
    if before_saved:
        # Past the matcher's 60-day slack (an application long before saving).
        return SAVED_AT - timedelta(days=rng.randint(75, 180))
    return SAVED_AT + timedelta(days=rng.randint(1, 60), hours=rng.randint(0, 23))


def _co(rng: random.Random, company: str) -> str:
    """The company as an email might spell it (case varies)."""
    return rng.choice((company, company.upper(), company.lower()))


def generate_matching_cases(seed: int = DEFAULT_SEED, per: int = 20) -> list[MatchCase]:
    """``per`` cases for each scenario, deterministic for a given seed."""
    rng = random.Random(seed)
    out: list[MatchCase] = []

    def add(scenario: str, n: int, **kw) -> None:
        out.append(MatchCase(id=f"{scenario}-{n:03d}", scenario=scenario, **kw))

    for n in range(per):
        # 1. No title, company in the text, the user's ONLY role there.
        j = _BY_KEY[rng.choice(_SINGLE)]
        co = _co(rng, j.company)
        _, frm = _person(rng, rng.choice(("gmail.example", "mailhost.example")))
        add(
            "no_title_single_role",
            n,
            subject=rng.choice(_SUBJECTS_NO_TITLE).format(co=co),
            from_addr=frm,
            text=rng.choice(_NO_TITLE_BODIES).format(co=co),
            date=_date(rng),
            expected_status=MATCHED,
            expected_evidence=COMPANY_DATE,
            expected_job=j.key,
        )

        # 2. Company named ONLY by the sender's domain (no name in subject/text).
        j = _BY_KEY[rng.choice(_SINGLE)]
        _, frm = _person(rng, j.domain)
        add(
            "company_only_in_domain",
            n,
            subject=rng.choice(_SUBJECTS_NO_TITLE[:4]),
            from_addr=frm,
            text=rng.choice(_NO_COMPANY_BODIES),
            date=_date(rng),
            expected_status=MATCHED,
            expected_evidence=COMPANY_DATE,
            expected_job=j.key,
        )

        # 3. Company only, but the email is from long before the job was saved:
        # an older application to the same company — ask, don't assume.
        j = _BY_KEY[rng.choice(_SINGLE)]
        co = _co(rng, j.company)
        _, frm = _person(rng, "mailhost.example")
        add(
            "company_only_predates_save",
            n,
            subject=rng.choice(_SUBJECTS_NO_TITLE).format(co=co),
            from_addr=frm,
            text=rng.choice(_NO_TITLE_BODIES).format(co=co),
            date=_date(rng, before_saved=True),
            expected_status=REVIEW,
            expected_evidence=COMPANY_ONLY,
            expected_job=j.key,
            expected_candidates=frozenset({j.key}),
        )

        # 4. Several roles at one company, no title: never pick one.
        truth = rng.choice(_MULTI)
        co = _co(rng, "Quillfeather Labs")
        sender_domain = rng.choice(("quillfeather.example", "mailhost.example"))
        _, frm = _person(rng, sender_domain)
        if rng.random() < 0.4:
            frm = f"Quillfeather Careers <careers@{sender_domain}>"
        add(
            "several_roles_no_title",
            n,
            subject=rng.choice(_SUBJECTS_NO_TITLE).format(co=co),
            from_addr=frm,
            text=rng.choice(_NO_TITLE_BODIES).format(co=co),
            date=_date(rng),
            expected_status=REVIEW,
            expected_evidence=SEVERAL_ROLES,
            expected_job=truth,
            expected_candidates=frozenset(_MULTI),
        )

        # 5. Several roles, the email names ONE of them: pick exactly that role.
        truth = rng.choice(_MULTI)
        title = _BY_KEY[truth].title
        co = _co(rng, "Quillfeather Labs")
        _, frm = _person(rng, "quillfeather.example")
        add(
            "several_roles_title_named",
            n,
            subject=rng.choice(
                (
                    f"Interview for {title}",
                    f"Your application: {title}",
                    f"{co} — {title}",
                )
            ),
            from_addr=frm,
            text=f"Thanks for applying for the {title} role at {co}. "
            + rng.choice(_NO_COMPANY_BODIES),
            date=_date(rng),
            expected_status=MATCHED,
            expected_evidence=COMPANY_TITLE,
            expected_job=truth,
        )

        # 6. Several roles, the email names two of them (a recruiter on both).
        a, b = rng.sample(_MULTI, 2)
        co = _co(rng, "Quillfeather Labs")
        _, frm = _person(rng, "quillfeather.example")
        add(
            "several_roles_two_titles",
            n,
            subject=f"{co} — next steps",
            from_addr=frm,
            text=f"You applied for both {_BY_KEY[a].title} and "
            f"{_BY_KEY[b].title}. We'd like to schedule an interview.",
            date=_date(rng),
            expected_status=REVIEW,
            expected_evidence=SEVERAL_JOBS,
            expected_job=a,
            expected_candidates=frozenset({a, b}),
        )

        # 7. Several roles via an ATS relay that names the company but no title.
        truth = rng.choice(_MULTI)
        co = _co(rng, "Quillfeather Labs")
        add(
            "several_roles_relay",
            n,
            subject=f"An update from {co}",
            from_addr=f"{co} via ApplyTrack <{rng.choice(_RELAYS)}>",
            text=rng.choice(_NO_TITLE_BODIES).format(co=co),
            date=_date(rng),
            expected_status=REVIEW,
            expected_evidence=SEVERAL_ROLES,
            expected_job=truth,
            expected_candidates=frozenset(_MULTI),
        )

        # 8. Title only, no company anywhere (a webmail recruiter).
        j = _BY_KEY[rng.choice(("J05", "J08", "J12", "J13", "J14"))]
        _, frm = _person(rng, "mailhost.example")
        add(
            "title_only",
            n,
            subject=f"Re: {j.title}",
            from_addr=frm,
            text=f"Following up about the {j.title} opening. "
            + rng.choice(_NO_COMPANY_BODIES),
            date=_date(rng),
            expected_status=REVIEW,
            expected_evidence=TITLE_ONLY,
            expected_job=j.key,
            expected_candidates=frozenset({j.key}),
        )

        # 9. A recruiter the user APPROVED an update from before writes again
        # with no title, about one of the several roles.
        truth = rng.choice(_MULTI)
        name = rng.choice(_PEOPLE)
        addr = f"{name.split()[0].lower()}@quillfeather.example"
        add(
            "several_roles_known_sender",
            n,
            subject=rng.choice(_SUBJECTS_NO_TITLE[:4]),
            from_addr=f"{name} <{addr}>",
            text="Sorry, I have to reschedule our interview. Are you free Monday?",
            date=_date(rng),
            expected_status=MATCHED,
            expected_evidence=KNOWN_SENDER,
            expected_job=truth,
            known_senders=((addr, (truth,)),),
        )

        # 10. The same, but from the shared careers@ inbox: approved history on a
        # shared address says nothing about which role — still review.
        truth = rng.choice(_MULTI)
        addr = "careers@quillfeather.example"
        add(
            "several_roles_shared_inbox_history",
            n,
            subject="Next steps",
            from_addr=f"Quillfeather Careers <{addr}>",
            text="We'd like to schedule an interview. What's your availability?",
            date=_date(rng),
            expected_status=REVIEW,
            expected_evidence=SEVERAL_ROLES,
            expected_job=truth,
            expected_candidates=frozenset(_MULTI),
            known_senders=((addr, (truth,)),),
        )
    return out
