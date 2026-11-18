"""Matcher stress cases: no title, company only, several roles at one company.

Synthetic only (see evals.email_matching_cases). The hard rule: an email is
auto-matched only to the job it is really about; when the evidence can't say,
it goes to review with that job among the candidates.
"""

from collections import Counter

import pytest

from app.services.email_match import MATCHED, REVIEW, match_job
from evals.email_matching_cases import (
    DEFAULT_SEED,
    generate_matching_cases,
    matching_jobs,
)

CASES = generate_matching_cases(DEFAULT_SEED)
JOBS = matching_jobs()


def _run(case):
    return match_job(
        JOBS,
        subject=case.subject,
        from_addr=case.from_addr,
        reply_to=case.reply_to,
        text=case.text,
        date=case.date,
        known_senders=case.known(),
    )


def test_cases_are_deterministic_and_cover_every_scenario():
    again = generate_matching_cases(DEFAULT_SEED)
    assert [c.id for c in again] == [c.id for c in CASES]
    assert [c.text for c in again] == [c.text for c in CASES]
    assert generate_matching_cases(DEFAULT_SEED + 1) != CASES
    counts = Counter(c.scenario for c in CASES)
    assert len(counts) == 10 and set(counts.values()) == {20}


def test_never_auto_matches_a_wrong_job():
    wrong = [
        (c.id, m.job["id"])
        for c in CASES
        if (m := _run(c)).status == MATCHED and m.job["id"] != c.expected_job
    ]
    assert wrong == []


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_case_outcome(case):
    m = _run(case)
    assert (m.status, m.evidence) == (case.expected_status, case.expected_evidence)
    if case.expected_status == MATCHED:
        assert m.job["id"] == case.expected_job
    else:
        offered = {j["id"] for j in m.candidates}
        assert case.expected_candidates <= offered
        assert case.expected_job in offered  # the user can pick the right one


def test_review_never_offers_unrelated_companies():
    for c in CASES:
        m = _run(c)
        if m.status == REVIEW and c.scenario.startswith("several_roles"):
            assert {j["company"] for j in m.candidates} == {"Quillfeather Labs"}
