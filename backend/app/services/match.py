"""Resume ↔ job-description match scoring.

Teal-style keyword coverage: which skills named in the job description does the
resume already show, and which are missing? Deliberately transparent (a visible
keyword list, not an opaque AI number) so the user can act on it — and the
"missing" list feeds straight into AI tailoring later.

Pure functions; no DB access here.
"""

import re
from dataclasses import dataclass, field

# Curated skills vocabulary (canonical, lowercase). Multi-word entries are
# matched as phrases. Scoped to the roles this app targets (full-stack /
# web-dev) plus general engineering practice + soft skills.
SKILLS: list[str] = [
    # Languages
    "python",
    "javascript",
    "typescript",
    "java",
    "c#",
    "c++",
    "go",
    "rust",
    "ruby",
    "php",
    "swift",
    "kotlin",
    "scala",
    "sql",
    "html",
    "css",
    "bash",
    # Frontend
    "react",
    "angular",
    "vue",
    "next.js",
    "svelte",
    "tailwind",
    "redux",
    "react native",
    "responsive design",
    "accessibility",
    "figma",
    "webpack",
    "vite",
    # Backend
    "node.js",
    "express",
    "django",
    "flask",
    "fastapi",
    "spring",
    ".net",
    "rails",
    "laravel",
    "graphql",
    "rest api",
    "rest apis",
    "microservices",
    "websocket",
    "grpc",
    # Data stores
    "postgresql",
    "postgres",
    "mysql",
    "mongodb",
    "redis",
    "sqlite",
    "elasticsearch",
    "dynamodb",
    "kafka",
    # Cloud / DevOps
    "aws",
    "azure",
    "gcp",
    "docker",
    "kubernetes",
    "terraform",
    "ci/cd",
    "jenkins",
    "github actions",
    "linux",
    "nginx",
    "serverless",
    "lambda",
    "devops",
    # Data / AI
    "machine learning",
    "deep learning",
    "pytorch",
    "tensorflow",
    "pandas",
    "numpy",
    "data analysis",
    "data engineering",
    "nlp",
    "llm",
    "computer vision",
    "etl",
    "spark",
    "data integration",
    # Practice
    "agile",
    "scrum",
    "git",
    "unit testing",
    "integration testing",
    "tdd",
    "code review",
    "code reviews",
    "debugging",
    "oop",
    "design patterns",
    "data structures",
    "algorithms",
    "security",
    "oauth",
    "jwt",
    "sdlc",
    "version control",
    "troubleshooting",
    "documentation",
    # Soft
    "communication",
    "leadership",
    "collaboration",
    "problem solving",
    "mentoring",
    "cross-functional",
]

# Variants that should count as the same skill when checking the RESUME side
# (job says "postgresql", resume says "postgres" — that's a match).
_EQUIVALENTS: dict[str, list[str]] = {
    "postgresql": ["postgres"],
    "postgres": ["postgresql"],
    "rest apis": ["rest api"],
    "rest api": ["rest apis"],
    "code reviews": ["code review"],
    "code review": ["code reviews"],
    "node.js": ["nodejs", "node js"],
    "next.js": ["nextjs", "next js"],
    "ci/cd": ["ci cd", "continuous integration"],
}


def _pattern(term: str) -> re.Pattern[str]:
    # Word-boundary-ish match that tolerates the symbols inside tech names
    # (c#, c++, node.js, ci/cd) — plain \b breaks on those.
    return re.compile(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", re.IGNORECASE)


def _contains(text: str, term: str) -> bool:
    if _pattern(term).search(text):
        return True
    return any(_pattern(alt).search(text) for alt in _EQUIVALENTS.get(term, []))


def extract_keywords(description: str) -> list[str]:
    """Skills from the vocabulary that the job description actually names."""
    found: list[str] = []
    seen: set[str] = set()
    for skill in SKILLS:
        # Collapse equivalent forms so "rest api"/"rest apis" isn't two keywords.
        canonical = min([skill, *_EQUIVALENTS.get(skill, [])], key=len)
        if canonical in seen:
            continue
        if _contains(description, skill):
            seen.add(canonical)
            found.append(skill)
    return found


@dataclass
class MatchResult:
    score: int  # 0-100 (% of the job's keywords covered by the resume)
    matched: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def match_resume(resume_text: str, description: str) -> MatchResult:
    """Which of the job's keywords does the resume cover?"""
    keywords = extract_keywords(description)
    if not keywords:
        return MatchResult(score=0)
    matched = [k for k in keywords if _contains(resume_text, k)]
    missing = [k for k in keywords if k not in matched]
    return MatchResult(
        score=round(len(matched) / len(keywords) * 100),
        matched=matched,
        missing=missing,
    )
