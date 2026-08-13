"""Unit tests for resume ↔ job-description match scoring."""

from app.services.match import extract_keywords, match_resume

JOB = """We're hiring a Full-Stack Engineer. You'll build customer-facing web
apps with React and TypeScript on the frontend and Python (FastAPI) services
on the backend, backed by PostgreSQL and Redis. You'll own features end to
end, write unit testing coverage, participate in code reviews, and deploy via
Docker and CI/CD on AWS. Strong communication skills required."""

RESUME = """Jane Doe — Full-stack developer. 3 years building React +
TypeScript SPAs and Python FastAPI backends with Postgres. Shipped a job
search app with Docker deploys on AWS. Passionate about testing and clear
communication."""


def test_extract_keywords_finds_named_skills():
    kws = extract_keywords(JOB)
    for expected in [
        "react",
        "typescript",
        "python",
        "fastapi",
        "postgresql",
        "redis",
        "docker",
        "ci/cd",
        "aws",
        "communication",
    ]:
        assert expected in kws, f"{expected} missing from {kws}"
    # Not named in the description → not a keyword.
    assert "kubernetes" not in kws


def test_symbol_heavy_terms_do_not_false_match():
    # "c" in "customer" must not match c# / c++; "go" in "good" must not match go.
    kws = extract_keywords("A good customer-focused role. No specific stack.")
    assert kws == []


def test_match_scores_coverage_and_lists_missing():
    result = match_resume(RESUME, JOB)
    assert result.matched, "resume should cover several keywords"
    # Postgres in resume counts for postgresql in job (equivalents).
    assert "postgresql" in result.matched
    # Redis / code reviews are in the job but not the resume.
    assert "redis" in result.missing
    assert 0 < result.score < 100
    assert result.score == round(
        len(result.matched) / (len(result.matched) + len(result.missing)) * 100
    )


def test_no_keywords_means_zero_score_not_crash():
    result = match_resume(RESUME, "We are a great place to work.")
    assert result.score == 0
    assert result.matched == []
    assert result.missing == []
