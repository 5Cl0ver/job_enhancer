"""Unit tests for the resume → profile heuristics (regex pass, no LLM)."""

from app.services.profile_extract import extract_contact_heuristics

RESUME_HEADER = """Fabian Example
Los Angeles, CA • (555) 010-0199 • fabian@example.com
https://www.linkedin.com/in/fabian-example • github.com/5Cl0ver
Portfolio: https://fabian.dev
"""


def test_heuristics_find_phone_and_links():
    out = extract_contact_heuristics(RESUME_HEADER)
    assert out["phone"] == "(555) 010-0199"
    assert out["linkedin_url"] == "https://www.linkedin.com/in/fabian-example"
    # Bare domain is normalized to a real URL.
    assert out["github_url"] == "https://github.com/5Cl0ver"
    # First non-linkedin/github URL is treated as the portfolio.
    assert out["portfolio_url"] == "https://fabian.dev"


def test_heuristics_ignore_missing_fields():
    out = extract_contact_heuristics("Just a resume with no contact block at all.")
    assert out == {}


def test_phone_format_variants():
    assert extract_contact_heuristics("call 555-010-0199 now")["phone"] == "555-010-0199"
    assert extract_contact_heuristics("+1 555.010.0199")["phone"] == "+1 555.010.0199"
