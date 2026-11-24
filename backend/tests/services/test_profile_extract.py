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
    assert (
        extract_contact_heuristics("call 555-010-0199 now")["phone"] == "555-010-0199"
    )
    assert extract_contact_heuristics("+1 555.010.0199")["phone"] == "+1 555.010.0199"


# --- spec 019 part B: name and city with no AI ----------------------------


def test_name_and_city_from_the_header():
    out = extract_contact_heuristics(RESUME_HEADER)
    assert (out["first_name"], out["last_name"]) == ("Fabian", "Example")
    assert (out["city"], out["state"]) == ("Los Angeles", "CA")


def test_all_caps_name_with_a_title_after_a_separator():
    out = extract_contact_heuristics(
        "WREN A. TESTER | Software Engineer\nAustin, TX 78701"
    )
    assert (out["first_name"], out["last_name"]) == ("Wren", "Tester")
    assert (out["city"], out["state"]) == ("Austin", "TX")


def test_heading_or_contact_lines_are_never_a_name():
    out = extract_contact_heuristics(
        "Curriculum Vitae\nwren@example.com\n555-010-0199\nWren Tester\n"
    )
    assert (out["first_name"], out["last_name"]) == ("Wren", "Tester")


def test_city_only_from_header_lines_and_real_states():
    body = "\n".join(["Wren Tester"] + ["Built things."] * 10 + ["Denver, CO"])
    assert "city" not in extract_contact_heuristics(body)
    assert "city" not in extract_contact_heuristics("Wren Tester\nParis, FR")


async def test_extract_profile_calls_no_ai_by_default(monkeypatch):
    from app.services import ai_service, profile_extract

    async def boom(*_a, **_k):  # pragma: no cover - must not run
        raise AssertionError("AI was called")

    monkeypatch.setattr(ai_service, "_invoke", boom)
    out = await profile_extract.extract_profile(RESUME_HEADER)
    assert out["first_name"] == "Fabian"
    assert out["phone"] == "(555) 010-0199"


def test_a_job_title_or_sentence_is_not_a_name():
    out = extract_contact_heuristics(
        "Senior Software Engineer\nBuilt things.\nWren Tester"
    )
    assert (out["first_name"], out["last_name"]) == ("Wren", "Tester")
