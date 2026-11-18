"""Score email-pipeline predictions against expected labels.

Pure functions over :class:`Scored` rows, so the same scorecard serves the
synthetic corpus now and a hand-labeled real-email file later (where only these
aggregate numbers — never the emails — leave the machine).

Two axes are scored separately: the email *type* (what the email says) and the
*card action* (whether, and where, the card should move). An interview reminder
is an interview email that should cause no card change.

Rates come with 95% Wilson intervals. Those treat every email as independent;
emails built from one template are not, so the real uncertainty is wider.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

from evals.email_pipeline import (
    APPLIED,
    ASSESSMENT,
    ERROR,
    EVENT_LABELS,
    EXPECTED_STAGE,
    INTERVIEW,
    OFFER,
    REJECTED,
    UNKNOWN,
    UNSURE,
)

# Good news that must never be reported as a rejection.
_GOOD_NEWS = {APPLIED, INTERVIEW, ASSESSMENT, OFFER}
# Events the user can't afford to miss.
_MUST_CATCH = {INTERVIEW, ASSESSMENT, OFFER}
NO_CHANGE = "no change"
_Z95 = 1.959964


def wilson(k: int, n: int, z: float = _Z95) -> tuple[float, float] | None:
    """Wilson score interval for k successes out of n (None when n == 0)."""
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


@dataclass(frozen=True)
class Rate:
    k: int
    n: int

    @property
    def value(self) -> float | None:
        return self.k / self.n if self.n else None

    @property
    def interval(self) -> tuple[float, float] | None:
        return wilson(self.k, self.n)


@dataclass(frozen=True)
class Scored:
    id: str
    template_id: str
    expected_event: str
    expected_job: str | None
    predicted_event: str
    predicted_job: str | None
    surfaced: bool = False  # would a scan create a pending card move?
    body_blank: bool = False
    expected_action: str | None = None  # stage the card should move to
    predicted_action: str | None = None  # stage of the pending move created
    read_issues: tuple[str, ...] = ()  # how reading the email went
    filtered: bool = False  # dropped by the header filter
    filter_reason: str = ""
    match_status: str = "none"  # matched | review | none
    match_evidence: str = ""


@dataclass
class CategoryScore:
    label: str
    support: int  # how many emails truly are this label
    predicted: int  # how many were predicted as this label
    true_positive: int

    @property
    def precision(self) -> Rate:
        return Rate(self.true_positive, self.predicted)

    @property
    def recall(self) -> Rate:
        return Rate(self.true_positive, self.support)


@dataclass
class JobScore:
    total: int = 0
    correct: int = 0  # predicted job == expected (both None counts)
    with_job: int = 0  # emails that ARE about a saved job
    with_job_correct: int = 0
    with_job_missed: int = 0  # matched nothing
    with_job_wrong: int = 0  # matched a different saved job
    without_job: int = 0  # emails about no saved job
    false_match: int = 0  # matched a job anyway
    surfaced_wrong_job: int = 0  # a pending card move for the wrong job
    with_job_review: int = 0  # about a saved job, sent to review (not wrong)
    without_job_review: int = 0  # about no saved job, sent to review
    evidence: dict[str, int] = field(default_factory=dict)  # how matches were made

    @property
    def accuracy(self) -> Rate:
        return Rate(self.correct, self.total)

    @property
    def wrong_job(self) -> int:
        return self.with_job_wrong + self.false_match


@dataclass
class CardScore:
    """Card actions: a move is correct only with the right stage AND job."""

    total: int = 0
    expected_moves: int = 0
    predicted_moves: int = 0
    correct_moves: int = 0
    missed_moves: int = 0  # a move was due, none was proposed
    wrong_moves: int = 0  # a move was due, a different stage or job proposed
    unwanted_moves: int = 0  # no change was due, a move was proposed
    expected_no_change: int = 0
    correct_no_change: int = 0
    confusion: dict[str, Counter] = field(default_factory=dict)

    @property
    def accuracy(self) -> Rate:
        return Rate(self.correct_moves + self.correct_no_change, self.total)

    @property
    def precision(self) -> Rate:
        return Rate(self.correct_moves, self.predicted_moves)

    @property
    def recall(self) -> Rate:
        return Rate(self.correct_moves, self.expected_moves)


@dataclass
class FilterScore:
    """Header filter: job emails must all be kept; non-job drops are a bonus."""

    applied: bool = False
    job_emails: int = 0  # expected event is not "unknown"
    job_kept: int = 0
    other_emails: int = 0
    other_dropped: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    @property
    def kept_all_job_emails(self) -> bool:
        return self.job_kept == self.job_emails


def _score_filter(rows: list[Scored]) -> FilterScore:
    fs = FilterScore(applied=any(r.filter_reason for r in rows))
    for r in rows:
        if r.filter_reason:
            fs.reasons[r.filter_reason] = fs.reasons.get(r.filter_reason, 0) + 1
        if r.expected_event == UNKNOWN:
            fs.other_emails += 1
            fs.other_dropped += r.filtered
        else:
            fs.job_emails += 1
            fs.job_kept += not r.filtered
    return fs


@dataclass
class ReadScore:
    """How reading went. Blank with no text part (attachment-only) is
    explained; any other blank is not."""

    total: int = 0
    failed: int = 0
    blank: int = 0
    blank_unexplained: int = 0
    charset_fallback: int = 0
    lossy_decode: int = 0
    quote_fallback: int = 0
    html_converted: int = 0
    hidden_removed: int = 0


def _score_reading(rows: list[Scored]) -> ReadScore:
    rs = ReadScore(total=len(rows))
    for r in rows:
        issues = set(r.read_issues)
        rs.failed += "parse_failed" in issues
        blank = r.body_blank and "parse_failed" not in issues
        rs.blank += blank
        rs.blank_unexplained += blank and "no_text_part" not in issues
        rs.charset_fallback += "charset_fallback" in issues
        rs.lossy_decode += "lossy_decode" in issues
        rs.quote_fallback += "quote_fallback" in issues
        rs.html_converted += "html_converted" in issues
        rs.hidden_removed += "hidden_removed" in issues
    return rs


@dataclass
class Scorecard:
    total: int
    labels: list[str]  # real event labels (+ any unexpected predicted label)
    categories: dict[str, CategoryScore]
    confusion: dict[str, Counter]  # expected → Counter(predicted)
    jobs: JobScore
    # The same, counted only where the scan would match: job emails (the
    # classifier said something other than unknown).
    pipeline_jobs: JobScore
    cards: CardScore
    reading: ReadScore
    filter: FilterScore
    crashes: int
    good_news_as_rejected: int
    missed_must_catch: int  # predicted something else (not unsure)
    must_catch_unsure: int  # sent to unsure: shown for review, no card move
    unsure: int  # all emails predicted unsure
    # (template_id, emails, wrong event, wrong job, wrong card action)
    worst_templates: list[tuple[str, int, int, int, int]] = field(default_factory=list)

    @property
    def event_accuracy(self) -> Rate:
        right = sum(c.true_positive for c in self.categories.values())
        return Rate(right, self.total)


def _score_cards(rows: list[Scored]) -> CardScore:
    cards = CardScore(total=len(rows))
    order = [*EXPECTED_STAGE.values(), NO_CHANGE]
    cards.confusion = {k: Counter() for k in order}
    for r in rows:
        exp, pred = r.expected_action, r.predicted_action
        cards.confusion.setdefault(exp or NO_CHANGE, Counter())[pred or NO_CHANGE] += 1
        cards.predicted_moves += pred is not None
        if exp is None:
            cards.expected_no_change += 1
            if pred is None:
                cards.correct_no_change += 1
            else:
                cards.unwanted_moves += 1
            continue
        cards.expected_moves += 1
        if pred is None:
            cards.missed_moves += 1
        elif pred == exp and r.predicted_job == r.expected_job:
            cards.correct_moves += 1
        else:
            cards.wrong_moves += 1
    return cards


def _score_jobs(rows: list[Scored]) -> JobScore:
    jobs = JobScore(total=len(rows))
    for r in rows:
        ok_job = r.predicted_job == r.expected_job
        jobs.correct += ok_job
        review = r.match_status == "review"
        if r.match_status == "matched":
            key = r.match_evidence or "matched"
            jobs.evidence[key] = jobs.evidence.get(key, 0) + 1
        if r.expected_job is not None:
            jobs.with_job += 1
            if ok_job:
                jobs.with_job_correct += 1
            elif r.predicted_job is None:
                if review:
                    jobs.with_job_review += 1
                else:
                    jobs.with_job_missed += 1
            else:
                jobs.with_job_wrong += 1
        else:
            jobs.without_job += 1
            jobs.false_match += r.predicted_job is not None
            jobs.without_job_review += review
        if r.surfaced and not ok_job:
            jobs.surfaced_wrong_job += 1
    return jobs


def _card_ok(r: Scored) -> bool:
    if r.predicted_action != r.expected_action:
        return False
    return r.expected_action is None or r.predicted_job == r.expected_job


def score(rows: list[Scored]) -> Scorecard:
    labels = list(EVENT_LABELS)
    # Unexpected predicted labels still get a column; ERROR is a crash count,
    # not a category, so it only appears in the confusion matrix.
    labels += sorted({r.predicted_event for r in rows} - set(labels) - {ERROR, UNSURE})

    confusion: dict[str, Counter] = {lab: Counter() for lab in EVENT_LABELS}
    for r in rows:
        confusion.setdefault(r.expected_event, Counter())[r.predicted_event] += 1

    predicted = Counter(r.predicted_event for r in rows)
    categories = {
        lab: CategoryScore(
            lab,
            support=sum(confusion.get(lab, Counter()).values()),
            predicted=predicted[lab],
            true_positive=confusion.get(lab, Counter())[lab],
        )
        for lab in labels
    }

    jobs = _score_jobs(rows)
    pipeline_jobs = _score_jobs(
        [r for r in rows if r.predicted_event not in (UNKNOWN, ERROR)]
    )
    per_template: dict[str, list[int]] = {}
    for r in rows:
        ok_job = r.predicted_job == r.expected_job
        ok_event = r.predicted_event == r.expected_event
        ok_card = _card_ok(r)
        stats = per_template.setdefault(r.template_id, [0, 0, 0, 0, 0])
        stats[0] += 1
        stats[1] += not ok_event
        stats[2] += not ok_job
        stats[3] += not ok_card
        stats[4] += not (ok_event and ok_job and ok_card)

    worst = [
        (tid, n, ev, jb, cd)
        for tid, (n, ev, jb, cd, bad) in sorted(
            per_template.items(), key=lambda kv: (-kv[1][4] / kv[1][0], kv[0])
        )
        if bad
    ]
    return Scorecard(
        total=len(rows),
        labels=labels,
        categories=categories,
        confusion=confusion,
        jobs=jobs,
        pipeline_jobs=pipeline_jobs,
        cards=_score_cards(rows),
        reading=_score_reading(rows),
        filter=_score_filter(rows),
        crashes=predicted[ERROR],
        good_news_as_rejected=sum(
            r.expected_event in _GOOD_NEWS and r.predicted_event == REJECTED
            for r in rows
        ),
        missed_must_catch=sum(
            r.expected_event in _MUST_CATCH
            and r.predicted_event not in (r.expected_event, UNSURE)
            for r in rows
        ),
        must_catch_unsure=sum(
            r.expected_event in _MUST_CATCH and r.predicted_event == UNSURE
            for r in rows
        ),
        unsure=predicted[UNSURE],
        worst_templates=worst,
    )


# --------------------------------------------------------------------------- #
# Plain-text report
# --------------------------------------------------------------------------- #
def _pct(x: float | None) -> str:
    return "  -   " if x is None else f"{x * 100:5.1f}%"


def _rate(r: Rate) -> str:
    """'85.7% [80.6-89.6]' — value with its 95% Wilson interval."""
    ci = r.interval
    if ci is None:
        return f"{'-':>6} {'':>13}"
    return f"{_pct(r.value)} [{ci[0] * 100:4.1f}-{ci[1] * 100:5.1f}]"


def _matrix(confusion: dict[str, Counter], cols: list[str], width: int = 8) -> list:
    short = {c: c[:6] for c in cols}
    lines = [f"{'':<22}" + "".join(f"{short[c]:>{width}}" for c in cols)]
    for exp, row in confusion.items():
        if row:
            lines.append(f"{exp:<22}" + "".join(f"{row[c]:>{width}}" for c in cols))
    return lines


def format_scorecard(card: Scorecard, *, title: str, templates: int = 10) -> str:
    out = [f"=== {title}: {card.total} emails ===", ""]
    out.append("rates show [95% Wilson interval]; same-template emails are not")
    out.append("independent, so true uncertainty is wider than shown")
    out += ["", "EMAIL TYPE", f"event accuracy: {_rate(card.event_accuracy)}", ""]
    out.append(f"{'category':<12}{'precision':>22}{'recall':>23}{'support':>9}")
    for lab in card.labels:
        c = card.categories[lab]
        if not c.support and not c.predicted:
            continue
        out.append(
            f"{lab:<12}{_rate(c.precision):>22}{_rate(c.recall):>23}{c.support:>9}"
        )

    cols = (
        list(card.labels)
        + ([UNSURE] if card.unsure else [])
        + ([ERROR] if card.crashes else [])
    )
    out += ["", "confusion (rows = expected, columns = predicted)"]
    out += _matrix(card.confusion, cols)

    j = card.jobs
    for title_, js in (
        ("JOB MATCHING (every email)", card.jobs),
        ("JOB MATCHING (as the scan does: job emails only)", card.pipeline_jobs),
    ):
        out += [
            "",
            title_,
            f"  accuracy (incl. correctly matching nothing): {_rate(js.accuracy)}",
            f"  about a saved job: {js.with_job}  correct {js.with_job_correct}  "
            f"sent to review {js.with_job_review}  missed {js.with_job_missed}  "
            f"wrong job {js.with_job_wrong}",
            f"  about no saved job: {js.without_job}  falsely matched "
            f"{js.false_match}  sent to review {js.without_job_review}",
            f"  wrong-job count: {js.wrong_job}  "
            f"(surfaced as a pending card move: {js.surfaced_wrong_job})",
            "  matched by: "
            + (", ".join(f"{k} {v}" for k, v in sorted(js.evidence.items())) or "-"),
        ]

    c = card.cards
    stage_cols = [*EXPECTED_STAGE.values(), NO_CHANGE]
    out += [
        "",
        "CARD ACTION (right stage AND right job)",
        f"  action accuracy: {_rate(c.accuracy)}",
        f"  move precision:  {_rate(c.precision)}  ({c.predicted_moves} proposed)",
        f"  move recall:     {_rate(c.recall)}  ({c.expected_moves} due)",
        f"  moves due: correct {c.correct_moves}  missed {c.missed_moves}  "
        f"wrong stage/job {c.wrong_moves}",
        f"  no change due: {c.expected_no_change}  kept {c.correct_no_change}  "
        f"unwanted moves {c.unwanted_moves}",
        "",
        "card confusion (rows = expected, columns = proposed)",
    ]
    out += _matrix(c.confusion, stage_cols, width=10)

    f = card.filter
    if f.applied:
        verdict = "YES" if f.kept_all_job_emails else "NO"
        out += [
            "",
            "HEADER FILTER",
            f"  kept 100% of job emails: {verdict} ({f.job_kept}/{f.job_emails})",
            f"  non-job emails dropped: {f.other_dropped}/{f.other_emails}",
            "  reasons: " + ", ".join(f"{k} {v}" for k, v in sorted(f.reasons.items())),
        ]

    rd = card.reading
    out += [
        "",
        "READING",
        f"  read failures: {rd.failed}   blank: {rd.blank} "
        f"(unexplained {rd.blank_unexplained})",
        f"  charset fallback: {rd.charset_fallback} (lossy {rd.lossy_decode})   "
        f"quote fallback: {rd.quote_fallback}",
        f"  html converted: {rd.html_converted}   "
        f"hidden text removed: {rd.hidden_removed}",
    ]

    out += [
        "",
        "DEFINITION-OF-CLEAN CHECKS (target: all 0)",
        f"  crashes: {card.crashes}",
        f"  read failures: {rd.failed}",
        f"  unexplained blank bodies: {rd.blank_unexplained}",
        f"  wrong-job matches: {j.wrong_job}",
        f"  good news marked rejected: {card.good_news_as_rejected}",
        f"  interviews/assessments/offers missed: {card.missed_must_catch}",
        f"  (sent to unsure for review: {card.must_catch_unsure}; "
        f"all unsure: {card.unsure})",
    ]
    if templates and card.worst_templates:
        out += ["", f"worst templates, top {templates}"]
        out.append(
            f"  {'template':<32}{'emails':>7}{'bad event':>11}{'bad job':>9}"
            f"{'bad card':>10}"
        )
        for tid, n, ev, jb, cd in card.worst_templates[:templates]:
            out.append(f"  {tid:<32}{n:>7}{ev:>11}{jb:>9}{cd:>10}")
    return "\n".join(out)
