"""Learning from Claude's runs (spec 029).

When Claude fills a box Job Catcher couldn't, and the user approves the
application at the review (Submit, or "I'll press Submit myself"), the question
and Claude's answer go into the user's autofill memory (``custom_answers``,
the spec 018/020 machinery), marked ``source="claude"`` so the user sees where
it came from and can change or delete it. Next time Job Catcher fills that box
itself.

Only facts Claude wrote (``claude: true``), never its best-judgment picks
(``guess: true``): an unchanged guess isn't something the user said. And only
what's safe to reuse everywhere. Never:

- passwords, ID numbers, bank or card details;
- self-identification (gender, race, ethnicity, veteran, disability, pronouns,
  date of birth…);
- agreements and consents (or anything Claude marked ``agreement``);
- essays (an essay question, or any answer over 300 characters);
- legal and eligibility questions (criminal history, citizenship, visas,
  sponsorship, work authorisation, security clearance);
- one company's answers (salary, relatives or former employees, "have you
  worked for us", anything naming the company);
- the user's own details (name, email, phone, address, links, schools, past
  jobs): those come from the profile and résumé, never from a run;
- an answer the user changed or asked about at the review, or one that
  changed between rounds;
- an answer the user deleted from Autofill memory (``users.forgotten_answers``);
- over an answer the user already has (theirs always wins).

The question key is the extension's ``normalizeQuestion`` (classify/answers.js),
so Job Catcher finds the answer by its usual exact-or-close match.
"""

import ast
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apply import ApplyRun
from app.models.custom_answer import CustomAnswer
from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.models.user import User

SOURCE = "claude"
MAX_ANSWER = 300
MAX_QUESTION = 300
MAX_LEARNED = 40
MAX_FORGOTTEN = 500

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
# Job Catcher's CONSENT, word for word.
_CONSENT = re.compile(
    r"\bi (have read|agree|accept|acknowledge|certify|attest|consent|understand|"
    r"confirm that|authori[sz]e)|\b(agree|accept)\b.*\b(terms|conditions|policy|"
    r"polic(y|ies))|terms (of|and|&)|terms\b|conditions\b|privacy (policy|notice)|"
    r"consent|acknowledg|attest|certif(y|ication that)|authori[sz]e .*(background|"
    r"credit|drug|check|verification)|background check|by (checking|clicking|"
    r"submitting)|e-?signature|electronic signature|signature",
    re.I,
)
_ESSAY = re.compile(
    r"cover[\s_-]*letter|why (do you|are you|would you|this|our|we)|"
    r"why .*(interest|join|work)|tell us (about|why)|describe|explain|"
    r"what (makes|interests|excites|motivates)|anything else|"
    r"additional (info|information|comments)|in your own words",
    re.I,
)
# Legal and eligibility questions: the user's to answer each time.
_LEGAL = re.compile(
    r"criminal|convict|felon|misdemeanou?r|offen[cs]e|arrest|"
    r"citizen|visa\b|sponsor|immigration|work (permit|authori[sz]ation)|"
    r"authori[sz]ed to work|legally (eligible|authori[sz]ed|able|entitled)|"
    r"right to work|eligib\w* to work|clearance",
    re.I,
)
# One company's answer (classify/answers.js COMPANY_SPECIFIC) and pay.
_COMPANY = re.compile(
    r"\b(our|this) (company|organi[sz]ation|firm|business)\b|"
    r"\b(previously |ever |currently )?(worked|been employed|applied|interviewed) "
    r"(for|at|with)\b|\bwith us\b|salary|compensation|\bpay\b|\bwage|\brate\b|"
    r"\brelatives?\b|\brelated to\b|family members?|\bfriends? (who|that)\b|"
    r"\b(know|relatives?|family|friends?) (anyone )?(who )?(works?|employed) "
    r"(here|for|at)\b|\balumn(i|us|a|ae)\b|\bformer (employee|staff|intern|"
    r"team member)\b|\bpreviously (been )?employed\b",
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
_LIST_TEXT = re.compile(r"^\[.*\]$", re.S)


def normalize(text: str) -> str:
    """The extension's normalizeQuestion: its key for a question."""
    t = (text or "").lower()
    t = re.sub(r"\(required\)|\(optional\)|required|optional", " ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:255]


def answer_text(value: Any) -> str:
    """An answer as the box shows it: a list of choices as "A, B" (never
    "['A', 'B']"), text as it is."""
    if isinstance(value, list | tuple):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    text = str(value if value is not None else "").strip()
    if _LIST_TEXT.match(text):
        try:
            parsed = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            return text
        if isinstance(parsed, list | tuple):
            return answer_text(list(parsed))
    return text


def _never(question: str, answer: str, company: str) -> bool:
    if company and re.search(rf"\b{re.escape(company)}\b", normalize(question)):
        return True  # about this company
    return bool(
        len(answer) > MAX_ANSWER
        or len(question) > MAX_QUESTION
        or _SELF_ID.search(question)
        or _PRIVATE.search(question)
        or _CONSENT.search(question)
        or _ESSAY.search(question)
        or _LEGAL.search(question)
        or _COMPANY.search(question)
        or _PROFILE.search(question)
    )


def fix_question(fix: Any) -> str:
    """The question a fix is about: `box_on_page` since spec 030 (the page's
    text, kept apart from the user's words), `q` before it."""
    if not isinstance(fix, dict):
        return ""
    return str(fix.get("box_on_page") or fix.get("q") or "").strip()


def changed_questions(
    review: dict | None, messages: list[dict[str, Any]] | None = None
) -> set[str]:
    """Questions the user changed or asked about at any review so far, and
    boxes they changed or asked about while Claude filled (spec 030)."""
    out = set((review or {}).get("changed") or [])
    fixes = [*((review or {}).get("fixes") or [])]
    fixes += [m.get("fix") for m in messages or [] if isinstance(m, dict)]
    for fix in fixes:
        if q := fix_question(fix):
            out.add(normalize(q))
    return out


def candidates(run: ApplyRun, company: str = "") -> list[tuple[str, str]]:
    """(question, answer) pairs from Claude's pages that are safe to learn."""
    company = normalize(company)
    changed = changed_questions(run.review, run.messages)
    seen: dict[str, tuple[str, str]] = {}
    given: dict[str, set[str]] = {}  # every answer each question got, any round
    for page in run.pages or []:
        for row in page.get("answers") or []:
            if not isinstance(row, dict):
                continue
            q = str(row.get("q") or "").strip()
            a = answer_text(row.get("a"))
            key = normalize(q)
            if not key:
                continue
            given.setdefault(key, set()).add(a)
            # Only what Claude wrote as a fact: never a pick (`guess`), an
            # agreement, or what Job Catcher filled.
            if row.get("claude") is not True or row.get("guess"):
                continue
            if row.get("agreement") or row.get("by") == "job_catcher":
                continue
            seen[key] = (q, a)
    out = []
    for key, (q, a) in seen.items():
        # Changed between rounds (or two answers on two pages): the user had a
        # say, or it isn't one answer.
        unstable = len(given.get(key, ())) > 1
        if key in changed or unstable or not a or len(key.split()) < 2:
            continue
        if _never(q, a, company):
            continue
        out.append((q, a))
    return out[:MAX_LEARNED]


async def _company(db: AsyncSession, run: ApplyRun) -> str:
    row = (
        await db.execute(
            select(SavedJob.custom_company, JobListing.company)
            .join(JobListing, JobListing.id == SavedJob.job_listing_id, isouter=True)
            .where(SavedJob.id == run.saved_job_id)
        )
    ).first()
    return (row and (row[0] or row[1])) or ""


async def learn(db: AsyncSession, run: ApplyRun) -> int:
    """Save what's safe to learn from the run as the user's answers ("from
    Claude"); never over an answer the user already has or deleted. How many
    were saved."""
    pairs = candidates(run, await _company(db, run))
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
    user = await db.get(User, run.user_id)
    have |= set((user.forgotten_answers if user else None) or [])
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


async def forget(db: AsyncSession, user_id: uuid.UUID, question_key: str) -> None:
    """The user deleted this answer: Claude's runs never learn it again."""
    user = await db.get(User, user_id)
    if user is None or not question_key:
        return
    keys = [k for k in (user.forgotten_answers or []) if k != question_key]
    user.forgotten_answers = [*keys, question_key[:255]][-MAX_FORGOTTEN:]


async def unforget(db: AsyncSession, user_id: uuid.UUID, keys: list[str]) -> None:
    """The user saved these answers themselves: no longer forgotten."""
    user = await db.get(User, user_id)
    if user is None or not user.forgotten_answers:
        return
    drop = set(keys)
    if drop & set(user.forgotten_answers):
        user.forgotten_answers = [k for k in user.forgotten_answers if k not in drop]


def note_changes(review: dict[str, Any], fixes: list[dict[str, Any]]) -> list[str]:
    """The review's running list of questions the user changed or asked about,
    kept across rounds (each new review starts fresh otherwise)."""
    keep = set(review.get("changed") or [])
    keep |= {normalize(q) for f in fixes if (q := fix_question(f))}
    return sorted(keep)[:200]
