"""Rule-based classification of job-application emails into pipeline signals.

Pure functions (no I/O, no AI) so they're fully unit-testable and cheap. The
classifier reads the **newest text** of an email (quoted history removed) plus
the subject, and works in three steps:

1. **Relevance gate.** The email must be about a job at all: it has to mention
   a job concept, and mail that looks like a newsletter, sale or job-alert
   digest must also address the reader's *own* application. Anything else is
   ``unknown`` — no evidence is even weighed.
2. **Sentence-level evidence.** Each sentence (and the subject) is checked
   against general phrase cues for each event, with a weight. A cue preceded
   by a negation ("we will *not* be scheduling…") is dropped; a cue inside a
   condition ("*if* your experience matches, we'll schedule…") counts for
   little. Rejection cues carry their own negation ("not moving forward"), and
   a confirmation that an application was received counts for little once an
   outcome (rejection, interview, assessment, offer) is present — outcome
   emails routinely restate the application.
3. **Decision.** The strongest event wins only with enough evidence and a clear
   lead. Weak or conflicting evidence returns ``unsure``: such emails are shown
   to the user but never propose a card move.

Email *type* is kept separate from card *action*: a reminder about an
interview is still an ``interview`` email, flagged ``reminder`` so it never
moves a card.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.email_prefilter import is_platform_sender

# Event kinds the classifier can emit.
REJECTED = "rejected"
INTERVIEW = "interview"
ASSESSMENT = "assessment"
OFFER = "offer"
APPLIED = "applied"
RECRUITER = "recruiter"
UNSURE = "unsure"  # job-related, but the evidence is weak or conflicting
UNKNOWN = "unknown"

# The pipeline stage each signal implies (None = no card move).
STAGE_FOR_EVENT: dict[str, str | None] = {
    REJECTED: "Rejected",
    INTERVIEW: "Interview",
    ASSESSMENT: "Take-Home Assignment",
    OFFER: "Offer",
    APPLIED: "Applied",
    RECRUITER: None,
    UNSURE: None,
    UNKNOWN: None,
}
_OUTCOMES = (REJECTED, INTERVIEW, ASSESSMENT, OFFER)

# Decision thresholds (sum of cue weights per event).
DECIDE_AT = 2.5  # below this, job evidence is too weak to act on → unsure
NOTICE_AT = 1.0  # below this there is no event evidence at all
CONFLICT_RATIO = 0.7  # runner-up this close to the winner → unsure


@dataclass(frozen=True)
class _Cue:
    event: str
    pattern: re.Pattern
    weight: float
    negatable: bool = True  # False when the negation is part of the pattern


def _cue(event: str, weight: float, pattern: str, negatable: bool = True) -> _Cue:
    return _Cue(event, re.compile(pattern, re.I), weight, negatable)


_ROLE = r"(?:role|position|job|opening|opportunity|vacancy|requisition)"
_CAND = r"(?:candidates?|applicants?|individuals?|people|profiles?|person)"
_GO = (
    r"(?:move|moving|moved|proceed|proceeding|go|going|advance|advancing|"
    r"continue|continuing)"
)

_CUES: list[_Cue] = [
    # ---------------------------------------------------------------- rejected
    _cue(REJECTED, 3, r"\bregret to (?:inform|let you know|tell you|share)", False),
    _cue(
        REJECTED,
        3,
        rf"\b{_GO} (?:forward |ahead )?with (?:other|another|different|a different|"
        rf"the other|more qualified|stronger) {_CAND}",
        False,
    ),
    _cue(
        REJECTED,
        3,
        rf"\b(?:not|n't|unable to|won't|will not|decided not to|chosen not to|"
        rf"no longer) (?:be )?{_GO} (?:forward|ahead|further)\b",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:chosen|selected|decided on|gone with|went with|hired|pursue|"
        r"pursuing|focus on|proceed with|offer(?:ed)? the "
        rf"{_ROLE} to) (?:another|a different|other|an internal|stronger|more "
        rf"qualified) {_CAND}",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:you|your (?:application|candidacy|profile|resume|submission))\b"
        r"[^.!?\n]{0,60}?\b(?:not|n't) (?:been |be )?(?:selected|shortlisted|chosen|"
        r"successful|considered|referred)\b",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:were|was|have been|has been) not (?:considered|qualified) for (?:the|"
        r"this|that) (?:position|role|job|opening)\b"
        r"|\bineligible for (?:the|this|these) (?:following )?"
        r"(?:position|role|job)s?\b",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\bno longer (?:under|in) consideration|\bno longer (?:being )?considered\b",
        False,
    ),
    _cue(
        REJECTED,
        3,
        rf"\b{_ROLE} (?:has been|was|is now|have been|has now been|is) (?:filled|"
        r"closed|cancell?ed|put on hold|withdrawn|no longer available)"
        rf"|\b(?:have|has|we've) (?:now |already )?(?:filled|closed|cancell?ed) "
        rf"(?:the|this|that) {_ROLE}",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:not|isn't|wasn't|aren't|weren't) (?:a |an |the )?(?:right |good |"
        r"strong |close |best |ideal )?(?:fit|match)\b(?=[^.!?\n]{0,80}\b(?:role|"
        r"position|job|opening|opportunity|requirements|needs)\b)",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:unable|not able|cannot|can't|won't be able) to (?:offer you|extend "
        r"(?:you )?an offer|move forward|proceed|advance|continue)",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:decided|chosen) (?:not to|against) (?:move|moving|proceed|proceeding|"
        r"pursue|pursuing|continue|continuing|advance|advancing|offer)",
        False,
    ),
    _cue(
        REJECTED,
        3,
        r"\b(?:will|shall|won't|will not) (?:not )?be (?:moving|proceeding|"
        r"advancing|continuing|pursuing|extending|offering|scheduling|inviting)\b"
        r"(?! (?:you )?to the next)",
        False,
    ),
    _cue(
        REJECTED,
        2.5,
        rf"\b{_CAND} whose (?:experience|qualifications|background|skills|profiles?)"
        r"|\bmore closely (?:match|matches|aligns?|aligned)\b",
        False,
    ),
    _cue(
        REJECTED,
        1.5,
        r"\bkeep (?:your |you )(?:resume|cv|application|details|information|profile)"
        r" on file|\bencourage you to (?:apply|keep an eye)",
        False,
    ),
    _cue(
        REJECTED,
        1.5,
        r"\b(?:best of luck|wish you (?:the best|every success|luck|well)) "
        r"(?:in|with) (?:your|the) (?:job )?(?:search|future|career|endeavou?rs)",
        False,
    ),
    # --------------------------------------------------------------- interview
    _cue(
        INTERVIEW,
        3,
        r"\b(?:schedule|set up|arrange|book|line up|coordinate|find a time for) "
        r"(?:a |an |your |the |our )?(?:quick |brief |short |first |initial |"
        r"\d+[- ]?min(?:ute)?s? |phone |video |zoom |technical |follow-up )?"
        r"(?:call|interview|chat|conversation|meeting|phone screen|screen(?:ing)?)\b",
    ),
    _cue(
        INTERVIEW,
        3,
        r"\binvite you (?:to|for) (?:a |an |the |our )?(?:[\w-]+ ){0,3}(?:interview|"
        r"conversation|call|round|onsite|on-site|chat|meeting|discussion)\b",
    ),
    _cue(
        INTERVIEW,
        3,
        r"\b(?:phone|video|technical|tech|onsite|on-site|final|first|second|third|"
        r"next|panel|hiring manager|behaviou?ral|virtual)[- ](?:screen|interview|"
        r"round)s?\b",
    ),
    _cue(
        INTERVIEW,
        3,
        r"\b(?:your|the) interview (?:is |has been |was )?(?:confirmed|scheduled|"
        r"booked|set)\b|\byour (?:upcoming )?interview\b",
    ),
    _cue(
        INTERVIEW,
        2.5,
        r"\b(?:share|send|provide|let (?:me|us) know|confirm) (?:me |us )?your "
        r"availability|\bwhat (?:times?|days?) (?:work|suits?)|\b(?:a few|some) "
        r"times that (?:work|suit)|\bwhen (?:are you|you're|would you be) "
        r"(?:free|available)|\bare you (?:free|available) (?:on|for|this|next)",
    ),
    _cue(
        INTERVIEW,
        2.5,
        r"\bcalendar invit\w*|\bscheduling link|\bbook a (?:time|slot)|\bpick a "
        r"(?:time|slot)|\bcalendly\.com|\bzoom\.us/j|\bmeet\.google\.com",
    ),
    _cue(
        INTERVIEW,
        2,
        r"\b(?:like|love|want) to (?:speak|chat|talk|meet|connect) (?:with you|"
        r"further|more)",
    ),
    _cue(
        INTERVIEW,
        2.5,
        r"\breschedul\w*|\bmove our (?:call|interview|meeting|chat)|\bpush (?:our|"
        r"the) (?:call|interview|meeting)",
    ),
    _cue(
        INTERVIEW,
        2,
        rf"\b{_GO} (?:forward |ahead )?with (?:your (?:application|candidacy)|you)\b"
        r"|\b(?:advance|progress|invite|move)(?: you)? to the next (?:stage|round|"
        r"step)|\bnext (?:stage|round|step) (?:of|in) (?:the|our) (?:hiring )?"
        r"(?:process|interview)",
    ),
    _cue(INTERVIEW, 2, r"\bspeaking with you|\bmet with you|\binterviewing with"),
    _cue(
        INTERVIEW,
        3,
        r"\binvitation to (?:a |an |your |the )?(?:[\w-]+ )?interview\b|"
        r"\b(?:in-person|in person|onsite|on-site|virtual) interview\b",
    ),
    # -------------------------------------------------------------- assessment
    _cue(
        ASSESSMENT,
        3,
        r"\b(?:take[- ]home|coding|technical|online|skills?|programming|written|"
        r"case|work sample) (?:assignment|assessment|challenge|exercise|test|task|"
        r"project|study)\b",
    ),
    _cue(
        ASSESSMENT,
        3,
        r"\bcomplete (?:a |an |the |our |this |your )?(?:[\w-]+ ){0,3}(?:assessment|"
        r"assignment|challenge|exercise|questionnaire|test)\b",
    ),
    _cue(
        ASSESSMENT,
        2.5,
        r"\b(?:assessment|test|challenge|assignment) (?:link|invitation|invite|"
        r"expires|deadline|is due|window)\b",
    ),
    _cue(
        ASSESSMENT,
        2,
        r"\b(?:hackerrank|codility|codesignal|testgorilla|hirevue|coderpad|"
        r"karat)\b",
    ),
    # ------------------------------------------------------------------- offer
    _cue(
        OFFER,
        3,
        r"\b(?:pleased|delighted|happy|excited|thrilled|glad) to (?:offer|extend) "
        r"(?:you )?(?:an? |the |our )?(?:formal |verbal |written |official )?"
        rf"(?:(?:[\w&-]+ ){{0,4}}{_ROLE}|offer)\b",
    ),
    _cue(
        OFFER,
        3,
        r"\bextend (?:you )?(?:an? |our )?(?:formal |verbal |written |official )?"
        r"offer\b|\boffer (?:letter|of employment|package|paperwork)\b",
    ),
    _cue(
        OFFER,
        2,
        r"\byour offer (?:details|letter|package|terms)\b|"
        r"\baccept (?:the|this|our|your) offer\b",
    ),
    _cue(
        OFFER,
        2,
        r"\bwelcome (?:you )?(?:to|aboard) the team\b|\b(?:excited|thrilled) to "
        r"have you join\b",
    ),
    _cue(
        OFFER,
        1,
        r"\b(?:base salary|compensation package|signing bonus|equity grant|"
        r"start date)\b",
    ),
    # ----------------------------------------------------------------- applied
    _cue(
        APPLIED,
        3,
        r"\b(?:we(?:'ve| have)? )?(?:received|got) your (?:job )?application\b|"
        r"\bapplication (?:has been |was |is )?(?:received|submitted|complete|"
        r"confirmed)\b|\bsuccessfully (?:applied|submitted)\b|\b(?:confirms?|"
        r"confirming) (?:receipt of |that we (?:have )?received )?your application",
    ),
    _cue(
        APPLIED,
        3,
        r"\b(?:your |the )?application\b[^.!?]{0,80}?\b(?:has been|was|is) "
        r"(?:successfully )?(?:received|submitted)\b|\bsubmitted successfully\b",
    ),
    _cue(
        APPLIED,
        2.5,
        r"\b(?:thank you|thanks) (?:so much )?for (?:applying|your application|"
        r"submitting your application)\b",
    ),
    _cue(
        APPLIED,
        1.5,
        r"\b(?:thank you|thanks) for (?:your|the) interest in (?:[\w&-]+ ){0,6}"
        rf"(?:{_ROLE}|team|company)\b",
    ),
    _cue(
        APPLIED,
        2,
        r"\b(?:will|'ll) (?:review|be reviewing|carefully review) your (?:application|"
        r"resume|cv|profile|background|qualifications)\b",
    ),
    # --------------------------------------------------------------- recruiter
    _cue(
        RECRUITER,
        2,
        r"\b(?:came across|found|saw|reviewed|noticed) your (?:profile|resume|cv|"
        r"background|linkedin|experience)\b",
    ),
    _cue(
        RECRUITER,
        2,
        r"\bopen to (?:a (?:chat|call|conversation)|hearing|learning|discussing|"
        r"exploring)\b|\binterested in (?:hearing|learning) more\b",
    ),
    _cue(
        RECRUITER,
        2,
        r"\bi(?:'m| am) (?:a |the |your )?(?:recruiter|talent partner|sourcer|"
        r"technical recruiter)\b|\bpoint of contact\b|\bintroduce myself\b",
    ),
]

# A cue is dropped when one of these comes shortly before it in the sentence.
_NEGATION = re.compile(
    r"\b(?:not|no|never|unable|cannot|can't|won't|wouldn't|don't|didn't|isn't|"
    r"aren't|wasn't|weren't|haven't|hasn't|without|neither|nor)\b",
    re.I,
)
# Outcome depends on something that hasn't happened yet: counts for little.
_CONDITIONAL = re.compile(
    r"\bif (?:you are|you're|your|we decide|we determine|you are selected|selected|"
    r"shortlisted|there is a (?:match|fit)|you (?:match|meet|move|progress|pass))|"
    r"\bshould (?:you|your|we)\b|\bonce we (?:have )?(?:review|reviewed|complete)|"
    r"\bin the event\b|\bwhether\b|\b(?:may|might|could) (?:be )?(?:contact|reach|"
    r"invite|ask|schedule|be in touch)|\bif (?:we|there)|\bif (?:they|needed|"
    r"necessary|required|appropriate|selected)\b|\b(?:contact|reach out to|be in "
    r"touch with) you (?:if|should|when|once)\b",
    re.I,
)
_CONDITIONAL_WEIGHT = 0.25
# A rejection that only might happen ("if you are not selected, ...").
_CONDITIONAL_REJECTION = re.compile(
    r"\bif (?:you are|you're|you were|your application is) not\b|\bshould you not\b|"
    r"\bif you (?:do not|don't) hear\b|\bif we (?:are unable|decide not|do not)\b|"
    r"\bif (?:your|you) (?:are )?(?:not selected|unsuccessful)\b",
    re.I,
)
# A sentence looking back at an interview that already happened ("thank you
# for your time on the call") isn't a new invite: interview cues count little.
_PAST_REFERENCE = re.compile(
    r"\bthank(?:s| you) for (?:your time|taking the time|meeting|speaking|"
    r"interviewing|chatting|talking)|\b(?:enjoyed|appreciated) (?:speaking|"
    r"meeting|talking|our|your)|\b(?:after|following) (?:your|our|the|last "
    r"week's) (?:interview|call|conversation|chat|meeting|screen)|\bit was "
    r"(?:great|nice|a pleasure|lovely) (?:to )?(?:speak|meet|talk|chat)",
    re.I,
)
_PAST_WEIGHT = 0.3
_SUBJECT_WEIGHT = 0.8

# --- relevance gate ------------------------------------------------------- #
_JOB_CONCEPT = re.compile(
    r"\b(?:appl(?:y|ied|ying|ication|icant)s?|candida\w+|positions?|roles?|jobs?|"
    r"interview\w*|recruit\w*|hiring|careers?|resume|cv|offer letter|"
    r"assessment|assignment|openings?|vacanc\w+|requisition|talent (?:team|"
    r"acquisition|partner)|hr team|employment|onboarding)\b",
    re.I,
)
# "Your profile" / "your background" are left out on purpose: they are how
# recommendation digests address the reader ("based on your profile").
_OWN_APPLICATION = re.compile(
    r"\byour (?:application|candidacy|interview|assessment|offer|resume|cv)\b|"
    r"\byou applied\b|\bapplying (?:to|for|with)\b|"
    r"\bapplication (?:for|to)\b|\binterviewing with\b|\binvite you\b|"
    r"\b(?:thank you|thanks) for (?:applying|your interest)\b",
    re.I,
)
_BULK_TEXT = re.compile(
    r"\bunsubscribe\b|\bmanage (?:your )?(?:email )?(?:preferences|subscriptions?)|"
    r"\bview (?:this email )?in (?:your )?browser|\bin this (?:issue|edition)\b|"
    r"\bnewsletter\b|\bwebinar\b|\d+ ?% off\b|\bshop now\b|\bsale (?:ends|starts)\b|"
    r"\blimited time\b|\bpromo code\b|\bfree trial\b|\bupgrade (?:now|your plan)\b|"
    r"\bthis week's\b",
    re.I,
)
# Job alerts, recommendation digests and "X is hiring" promos: never an
# update about the reader's own application.
_JOB_ALERT = re.compile(
    r"\bjob alerts?\b|\bjobs? (?:near|for) you\b|\b(?:new|recommended|similar|"
    r"suggested|top) jobs\b|\bjobs you (?:may|might) (?:like|be interested)|"
    r"\band \d+ more jobs\b|\b\d+\+? new jobs\b|\beasily apply\b|\beasy apply\b|"
    r"\bsee all (?:jobs|positions|openings)\b|\bjobs? (?:that )?match(?:es|ing)? your\b"
    r"|\brecommended for you\b|\b(?:based on|matching) your (?:profile|preferences|"
    r"search(?:es)?|activity|job search|skills)\b|\btop (?:job )?picks\b|"
    r"\b(?:is|are|now) hiring\b|\bpeople (?:also )?(?:viewed|applied)\b|"
    r"\byou (?:may|might) (?:also )?be a (?:good |great )?(?:fit|match)\b|"
    r"\bnew (?:job )?(?:opportunities|openings|positions|roles) (?:for|near|"
    r"matching|that match)\b|\bjobs? (?:you|we) (?:think|recommend)\b",
    re.I,
)
_REMINDER = re.compile(
    r"^\s*reminder\b|\bthis is a (?:friendly |quick )?reminder\b|\b(?:upcoming|"
    r"tomorrow's|today's) (?:interview|call|meeting|assessment)\b|\b(?:expires?|"
    r"due|closes?) (?:soon|tomorrow|today|in \d+)|\bdon't forget\b|\byou have not "
    r"(?:yet )?(?:started|completed|finished)\b|\bjust a reminder\b",
    re.I,
)
_AUTOMATED_SENDER = re.compile(
    r"no-?reply|do-?not-?reply|notifications?@|mailer@|alerts?@|news(?:letter)?@|"
    r"digest@|notify@|jobalerts|deals@|offers@|orders?@|promo",
    re.I,
)
# A talent/careers mailbox or a hiring platform is itself a job signal.
_JOB_SENDER = re.compile(
    r"\b(?:talent|recruit\w*|careers?|jobs|hiring|staffing|hr|people (?:team|"
    r"ops))\b|(?:talent|recruit\w*|careers?|staffing|hiring)[\w-]*\.",
    re.I,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


@dataclass
class Classification:
    event: str
    scores: dict[str, float] = field(default_factory=dict)
    evidence: list[tuple[str, str, float]] = field(default_factory=list)
    relevant: bool = False
    reminder: bool = False
    reason: str = ""  # why: gate | alert | decided | weak | conflict | contact


# Account and shopping mail a hiring site or a saved company also sends.
_NOT_HIRING = re.compile(
    r"\b(?:verification|security|sign[- ]?in|login|one[- ]time|access) (?:code|link)\b"
    r"|\bpass(?:word|code) reset\b|\breset your password\b"
    r"|\b(?:statement|bill|invoice|receipt|payment|order|shipment|delivery|refund)\b"
    r"|\breturn (?:label|request)\b|\bprinting information\b",
    re.I,
)


def _sentences(subject: str, text: str) -> list[tuple[str, float]]:
    out = [(subject.strip(), _SUBJECT_WEIGHT)] if subject and subject.strip() else []
    for s in _SENTENCE.split(text or ""):
        s = s.strip(" \t>-*•")
        if s:
            out.append((s, 1.0))
    return out


def _negated(sentence: str, start: int) -> bool:
    window = sentence[max(0, start - 40) : start]
    return bool(_NEGATION.search(window))


def _evidence(subject: str, text: str):
    """Per-event scores: each cue counts once (its best sentence)."""
    best: dict[int, tuple[float, str]] = {}
    for sentence, factor in _sentences(subject, text):
        conditional = bool(_CONDITIONAL.search(sentence))
        maybe_rejected = bool(_CONDITIONAL_REJECTION.search(sentence))
        looking_back = bool(_PAST_REFERENCE.search(sentence))
        for i, cue in enumerate(_CUES):
            for m in cue.pattern.finditer(sentence):
                if cue.negatable and _negated(sentence, m.start()):
                    continue
                w = cue.weight * factor
                if conditional and cue.event != REJECTED:
                    w *= _CONDITIONAL_WEIGHT
                if maybe_rejected and cue.event == REJECTED:
                    w *= _CONDITIONAL_WEIGHT
                if looking_back and cue.event == INTERVIEW:
                    w *= _PAST_WEIGHT
                if w > best.get(i, (0.0, ""))[0]:
                    best[i] = (w, m.group(0))
    scores: dict[str, float] = {}
    evidence: list[tuple[str, str, float]] = []
    for i, (w, text_hit) in best.items():
        ev = _CUES[i].event
        scores[ev] = scores.get(ev, 0.0) + w
        evidence.append((ev, text_hit, round(w, 2)))
    return scores, evidence


def classify(
    subject: str,
    text: str,
    from_addr: str = "",
    *,
    bulk: bool = False,
    job_sender: bool = False,
) -> Classification:
    """Classify one email from its subject and NEWEST text.

    ``bulk`` marks list/marketing mail by its headers (List-Unsubscribe etc.);
    such mail, like mail whose text looks like a newsletter or sale, must
    address the reader's own application to pass the relevance gate.
    ``job_sender`` marks a sender whose own domain names one of the user's
    saved companies (see ``email_match.sender_is_saved_company``): that alone
    makes the email about a job ("can we move our call to Monday?").
    """
    subject = subject or ""
    text = text or ""
    joined = f"{subject}\n{text}"
    reminder = bool(_REMINDER.search(subject) or _REMINDER.search(text))

    if _JOB_ALERT.search(joined) and not _OWN_APPLICATION.search(joined):
        return Classification(UNKNOWN, reason="alert")

    scores, evidence = _evidence(subject, text)
    # Gate: about a job at all; and list/marketing-looking mail must address the
    # reader's own application (or reject them, which is applicant-directed).
    looks_bulk = bulk or bool(_BULK_TEXT.search(joined))
    about_jobs = (
        bool(_JOB_CONCEPT.search(joined))
        or bool(_JOB_SENDER.search(from_addr or ""))
        or is_platform_sender(from_addr or "")
        or job_sender
    )
    relevant = about_jobs and (
        not looks_bulk
        or bool(_OWN_APPLICATION.search(joined))
        or scores.get(REJECTED, 0.0) >= DECIDE_AT
    )
    if not relevant:
        return Classification(UNKNOWN, reason="gate")

    outcome = max((scores.get(e, 0.0) for e in _OUTCOMES), default=0.0)
    if outcome >= DECIDE_AT and APPLIED in scores:
        # Outcome emails restate the application; that isn't a new receipt.
        scores[APPLIED] *= 0.3
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top_event, top = ranked[0] if ranked else (UNKNOWN, 0.0)
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    result = Classification(UNKNOWN, scores, evidence, relevant=True, reminder=reminder)

    human = bool(from_addr) and not _AUTOMATED_SENDER.search(from_addr)
    hiring_sender = job_sender or bool(_JOB_SENDER.search(from_addr or ""))
    if top < NOTICE_AT:
        if _NOT_HIRING.search(subject):
            # Sign-in codes, bills, orders: from a "job" domain, not a contact.
            result.event, result.reason = UNKNOWN, "account"
        elif human and hiring_sender and not looks_bulk:
            result.event, result.reason = RECRUITER, "contact"
        elif _OWN_APPLICATION.search(joined):
            # About the reader's application, but no outcome we can read
            # (e.g. "sign in to see your status"): show it, move nothing.
            result.event, result.reason = UNSURE, "no_outcome"
        else:
            result.event, result.reason = UNKNOWN, "no_evidence"
    elif top_event == RECRUITER and second < NOTICE_AT:
        result.event, result.reason = RECRUITER, "contact"
    elif top < DECIDE_AT:
        result.event, result.reason = UNSURE, "weak"
    elif second >= DECIDE_AT and second >= CONFLICT_RATIO * top:
        result.event, result.reason = UNSURE, "conflict"
    elif scores.get(REJECTED, 0.0) >= DECIDE_AT and any(
        scores.get(e, 0.0) >= DECIDE_AT for e in (INTERVIEW, ASSESSMENT, OFFER)
    ):
        # Good and bad news in the same newest text: never guess the polarity.
        result.event, result.reason = UNSURE, "conflict"
    else:
        result.event, result.reason = top_event, "decided"
    return result


def classify_email(subject: str, body: str, from_addr: str = "") -> str:
    """Event kind for one email (see :func:`classify`). ``body`` should be the
    newest text of the email."""
    return classify(subject, body, from_addr).event


def stage_for_event(event: str) -> str | None:
    """The target pipeline stage for a classified event, or None (no move)."""
    return STAGE_FOR_EVENT.get(event)


# --------------------------------------------------------------------------- #
# Sender domain → company (matching itself lives in app.services.email_match)
# --------------------------------------------------------------------------- #
# Webmail domains say nothing about an employer.
_WEBMAIL = re.compile(
    r"(?:^|\.)(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|"
    r"aol|proton|protonmail|pm)\.",
    re.I,
)
# Common two-label public suffixes, so "globex.co.uk" -> "globex" not "co".
_COMPOUND_TLDS = {
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "co.nz",
    "co.jp",
    "com.br",
    "co.in",
    "com.mx",
    "co.za",
    "com.sg",
}


def company_from_sender(from_addr: str) -> str:
    """Best-effort company name from an email address's domain. Returns "" for
    hiring platforms / job boards / ATS relays (see ``email_prefilter``) and
    webmail, where the domain says nothing about the employer."""
    m = re.search(r"@([\w.-]+)", from_addr or "")
    if not m:
        return ""
    domain = m.group(1).lower()
    if is_platform_sender(f"x@{domain}") or _WEBMAIL.search(domain + "."):
        return ""
    parts = domain.split(".")
    # Drop the TLD — two labels for compound TLDs (co.uk), else one.
    if len(parts) >= 2 and ".".join(parts[-2:]) in _COMPOUND_TLDS:
        parts = parts[:-2]
    else:
        parts = parts[:-1]
    # Drop generic subdomains so the employer label remains.
    parts = [
        p
        for p in parts
        if p not in {"www", "mail", "careers", "jobs", "recruiting", "talent"}
    ]
    return parts[-1] if parts else ""
