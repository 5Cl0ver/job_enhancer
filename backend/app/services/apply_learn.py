"""Learning from Claude's runs (spec 029).

When Claude fills a box Job Catcher couldn't, and the user approves the
application at the review (Submit, or "I'll press Submit myself"), the question
and Claude's answer go into the user's autofill memory (``custom_answers``,
the spec 018/020 machinery), marked ``source="claude"`` so the user sees where
it came from and can change or delete it. Next time Job Catcher fills that box
itself.

Only what's safe to reuse everywhere is learned. Never:

- passwords, ID numbers, bank or card details;
- self-identification (gender, race, ethnicity, veteran, disability, pronouns,
  date of birth…);
- agreements and consents (or anything Claude marked ``agreement``);
- essays (an essay question, or any answer over 300 characters);
- one company's answers (salary, "have you worked for us before");
- the user's own details (name, email, phone, address, links, schools, past
  jobs): those come from the profile and résumé, never from a run;
- an answer the user changed or asked about at the review, or one that
  changed between rounds;
- over an answer the user already has (theirs always wins).

The question key is the extension's ``normalizeQuestion`` (classify/answers.js),
so Job Catcher finds the answer by its usual exact-or-close match.
"""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apply import ApplyRun
from app.models.custom_answer import CustomAnswer

SOURCE = "claude"
MAX_ANSWER = 300
MAX_QUESTION = 300
MAX_LEARNED = 40

# The same guards Job Catcher uses (extension/src/autofill/classify/profileKeys.js).
_SELF_ID = re.compile(
    r"ethnic|\brace\b|racial|gender|\bsex\b|hispanic|latin[ox]|veteran|military|"
    r"armed forces|disab(?:led|ilit)|handicap|sexual orientation|lgbtq?|transgender|"
    r"\bpronouns?\b|voluntary (self[- ]?)?(identification|disclosure)|"
    r"self[- ]identif|date of birth|birth ?date|\bdob\b|marital|religio|pregnan",
    re.I,
)
_PRIVATE = re.compile(
    r"password|passcode|\bpin\b|\bssn\b|social security|national (id|insurance)|"
    r"passport|driver'?s?\s*licen[cs]e|licen[cs]e (number|no)|tax (id|number)|"
    r"\btin\b|bank|routing|account number|credit card|card number|\bcvv\b|\bcvc\b|"
    r"mother'?s maiden",
    re.I,
)
_CONSENT = re.compile(
    r"\bi (have read|agree|accept|acknowledge|certify|attest|consent|understand|"
    r"confirm that|authori[sz]e)|\b(agree|accept)\b.*\b(terms|conditions|polic)|"
    r"terms (of|and|&)|privacy (policy|notice)|consent|acknowledg|attest|"
    r"background check|by (checking|clicking|submitting)|signature",
    re.I,
)
_ESSAY = re.compile(
    r"cover[\s_-]*letter|why (do you|are you|would you|this|our|we)|"
    r"why .*(interest|join|work)|tell us (about|why)|describe|explain|"
    r"what (makes|interests|excites|motivates)|anything else|"
    r"additional (info|information|comments)|in your own words",
    re.I,
)
# One company's answer (classify/answers.js COMPANY_SPECIFIC) and pay.
_COMPANY = re.compile(
    r"\b(our|this) (company|organi[sz]ation|firm|business)\b|"
    r"\b(previously |ever |currently )?(worked|been employed|applied|interviewed) "
    r"(for|at|with)\b|\bwith us\b|salary|compensation|\bpay\b|\bwage|\brate\b|"
    r"\b(know|relatives?|family|friends?) (anyone )?(who )?(works?|employed) "
    r"(here|for|at)\b|\balumn(i|us|a|ae)\b|\bformer (employee|staff|intern)\b|"
    r"\bpreviously (been )?employed\b",
    re.I,
)
# The user's own details: the profile and the résumé answer these.
_PROFILE = re.compile(
    r"\bname\b|e-?mail|phone|mobile|\bcell\b|extension|address|street|\bcity\b|"
    r"\bstate\b|province|postal|\bzip\b|country|linked ?in|git ?hub|website|"
    r"portfolio|\burl\b|school|universit|college|degree|major|\bgpa\b|"
    r"graduat|employer|company name|job title|\bdate\b|today|"
    r"r[ée]sum[ée]|\bcv\b|upload|attach",
    re.I,
)


def normalize(text: str) -> str:
    """The extension's normalizeQuestion: its key for a question."""
    t = (text or "").lower()
    t = re.sub(r"\(required\)|\(optional\)|required|optional", " ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:255]


def _never(question: str, answer: str) -> bool:
    return bool(
        len(answer) > MAX_ANSWER
        or len(question) > MAX_QUESTION
        or _SELF_ID.search(question)
        or _PRIVATE.search(question)
        or _CONSENT.search(question)
        or _ESSAY.search(question)
        or _COMPANY.search(question)
        or _PROFILE.search(question)
    )


def changed_questions(review: dict | None) -> set[str]:
    """Questions the user changed or asked about at any review so far."""
    out = set((review or {}).get("changed") or [])
    for fix in (review or {}).get("fixes") or []:
        if isinstance(fix, dict) and fix.get("q"):
            out.add(normalize(fix["q"]))
    return out


def candidates(run: ApplyRun) -> list[tuple[str, str]]:
    """(question, answer) pairs from Claude's pages that are safe to learn."""
    changed = changed_questions(run.review)
    seen: dict[str, tuple[str, str]] = {}
    given: dict[str, set[str]] = {}  # every answer each question got, any round
    for page in run.pages or []:
        for row in page.get("answers") or []:
            if not isinstance(row, dict):
                continue
            q = str(row.get("q") or "").strip()
            a = str(row.get("a") or "").strip()
            key = normalize(q)
            if not key:
                continue
            given.setdefault(key, set()).add(a)
            mine = row.get("claude") is True or row.get("guess") is True
            if not mine or row.get("agreement") or row.get("by") == "job_catcher":
                continue
            seen[key] = (q, a)
    out = []
    for key, (q, a) in seen.items():
        # Changed between rounds (or two answers on two pages): the user had a
        # say, or it isn't one answer.
        unstable = len(given.get(key, ())) > 1
        if key in changed or unstable or not a or len(key.split()) < 2:
            continue
        if _never(q, a):
            continue
        out.append((q, a))
    return out[:MAX_LEARNED]


async def learn(db: AsyncSession, run: ApplyRun) -> int:
    """Save what's safe to learn from the run as the user's answers ("from
    Claude"); never over an answer the user already has. How many were saved."""
    pairs = candidates(run)
    if not pairs:
        return 0
    keys = {normalize(q)[:200] for q, _ in pairs}
    have = set(
        await db.scalars(
            select(CustomAnswer.question_key).where(
                CustomAnswer.user_id == run.user_id,
                CustomAnswer.question_key.in_(keys),
            )
        )
    )
    n = 0
    for q, a in pairs:
        key = normalize(q)[:200]
        if key in have:
            continue
        have.add(key)
        db.add(
            CustomAnswer(
                user_id=run.user_id,
                question_key=key,
                question_text=q[:500],
                answer=a,
                source=SOURCE,
            )
        )
        n += 1
    if n:
        await db.flush()
    return n


def note_changes(review: dict[str, Any], fixes: list[dict[str, Any]]) -> list[str]:
    """The review's running list of questions the user changed or asked about,
    kept across rounds (each new review starts fresh otherwise)."""
    keep = set(review.get("changed") or [])
    keep |= {normalize(f["q"]) for f in fixes if f.get("q")}
    return sorted(keep)[:200]
