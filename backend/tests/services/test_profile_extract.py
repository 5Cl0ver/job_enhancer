"""Unit tests for the resume → profile heuristics (regex pass, no LLM)."""

from app.services.profile_extract import extract_contact_heuristics

RESUME_HEADER = """Sam Example
Los Angeles, CA • (555) 010-0199 • sam@example.com
https://www.linkedin.com/in/sam-example • github.com/5Cl0ver
Portfolio: https://sam.dev
"""


def test_heuristics_find_phone_and_links():
    out = extract_contact_heuristics(RESUME_HEADER)
    assert out["phone"] == "(555) 010-0199"
    assert out["linkedin_url"] == "https://www.linkedin.com/in/sam-example"
    # Bare domain is normalized to a real URL.
    assert out["github_url"] == "https://github.com/5Cl0ver"
    # First non-linkedin/github URL is treated as the portfolio.
    assert out["portfolio_url"] == "https://sam.dev"


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
    assert (out["first_name"], out["last_name"]) == ("Sam", "Example")
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
    assert out["first_name"] == "Sam"
    assert out["phone"] == "(555) 010-0199"


def test_a_job_title_or_sentence_is_not_a_name():
    out = extract_contact_heuristics(
        "Senior Software Engineer\nBuilt things.\nWren Tester"
    )
    assert (out["first_name"], out["last_name"]) == ("Wren", "Tester")


# Review cases: real résumé headers (invented people).
def _name(text):
    out = extract_contact_heuristics(text)
    return out.get("first_name"), out.get("last_name")


def test_credentials_after_the_name_are_not_a_city_or_a_reason_to_skip():
    out = extract_contact_heuristics("Jane Doe, MD\nBaltimore, MD")
    assert _name("Jane Doe, MD\nBaltimore, MD") == ("Jane", "Doe")
    assert (out["city"], out["state"]) == ("Baltimore", "MD")
    assert _name("Jane Doe, PhD\nData Scientist") == ("Jane", "Doe")
    assert _name("John Smith, CPA, PMP\nCertified Public Accountant") == (
        "John",
        "Smith",
    )


def test_particles_suffixes_and_any_alphabet():
    assert _name("Maria de la Cruz\nData Scientist") == ("Maria", "Cruz")
    assert _name("John Smith Jr.\nAnalyst") == ("John", "Smith")
    assert _name("Łukasz Kowalski\nProduct Owner") == ("Łukasz", "Kowalski")
    assert _name("Nguyễn Văn An\nProduct Owner") == ("Nguyễn", "An")
    assert _name("JOHN O'BRIEN") == ("John", "O'Brien")


def test_headings_are_not_names_and_cities_are_real():
    assert _name("Work History\nResults Driven Leader\nWren Tester") == (
        "Wren",
        "Tester",
    )
    out = extract_contact_heuristics("Wren Tester\nSan Francisco Bay Area, CA")
    assert out["city"] == "San Francisco Bay Area"
    assert "city" not in extract_contact_heuristics("Wren Tester\nREMOTE, OR")
    assert "city" not in extract_contact_heuristics("Wren Tester\nRemote, OR")


def test_re_review_cases():
    out = extract_contact_heuristics(
        "Jane Doe | Austin, TX | jane@x.com | (555) 010-0199"
    )
    assert _name("Jane Doe | Austin, TX") == ("Jane", "Doe")
    assert (out["city"], out["state"]) == ("Austin", "TX")
    out = extract_contact_heuristics("JANE DOE • AUSTIN, TX")
    assert (out["city"], out["state"]) == ("Austin", "TX")
    # A city line first (a right-hand contact column) is not a name.
    assert _name("New York, NY\nJane Doe") == ("Jane", "Doe")
    assert _name("Al Pacino\nActor") == ("Al", "Pacino")
    assert _name("La Toya Jackson") == ("La", "Jackson")
    assert _name("Dr. Jane Doe") == ("Jane", "Doe")
    out = extract_contact_heuristics("Wren Tester\nSAN DIEGO, CA")
    assert out["city"] == "San Diego"
    assert "city" not in extract_contact_heuristics("Wren Tester\nIT Support, ME")
