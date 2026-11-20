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
# matched as phrases. Covers the roles this app is used for: software / web
# development, IT administration and identity, business and systems analysis,
# plus general engineering practice and soft skills. Only terms that mean a
# skill wherever they appear ("microsoft teams", not "teams").
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
    # IT administration / systems / identity
    "powershell",
    "active directory",
    "entra id",
    "microsoft 365",
    "intune",
    "sccm",
    "group policy",
    "exchange online",
    "sharepoint",
    "microsoft teams",
    "windows server",
    "vmware",
    "hyper-v",
    "dns",
    "dhcp",
    "vpn",
    "tcp/ip",
    "firewalls",
    "okta",
    "sso",
    "saml",
    "mfa",
    "iam",
    "mdm",
    "jamf",
    "patch management",
    "disaster recovery",
    "help desk",
    "itil",
    "servicenow",
    "jira",
    "confluence",
    "zendesk",
    "google workspace",
    "macos",
    "ansible",
    "automation",
    "scripting",
    "splunk",
    # Business / systems analysis
    "business analysis",
    "requirements gathering",
    "user stories",
    "process mapping",
    "process improvement",
    "stakeholder management",
    "uat",
    "power bi",
    "tableau",
    "visio",
    "salesforce",
    "erp",
    "crm",
    "data visualization",
    "project management",
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
    "microsoft 365": ["office 365", "m365", "o365"],
    "entra id": ["azure ad", "azure active directory", "microsoft entra"],
    "sccm": ["mecm", "configuration manager"],
    "exchange online": ["microsoft exchange", "exchange server"],
    "microsoft teams": ["ms teams"],
    "firewalls": ["firewall"],
    "sso": ["single sign-on", "single sign on"],
    "mfa": ["multi-factor authentication", "multifactor authentication", "2fa"],
    "iam": ["identity and access management", "identity management"],
    "mdm": ["mobile device management"],
    "help desk": ["helpdesk", "service desk"],
    "servicenow": ["service now"],
    "uat": ["user acceptance testing"],
    "erp": ["enterprise resource planning"],
}

# General strengths, not the "key skills for this kind of role" a resume type
# lists; left out when suggesting skills from a resume.
_SOFT: frozenset[str] = frozenset(
    {
        "communication",
        "leadership",
        "collaboration",
        "problem solving",
        "mentoring",
        "cross-functional",
        "documentation",
        "troubleshooting",
    }
)


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


def skills_in_resume(resume_text: str, limit: int = 20) -> list[str]:
    """The known skills a resume names, written the way the resume writes them
    ("PowerShell", "Azure AD") and in the order it first mentions them, which
    is roughly the order its author cares about. For pre-filling a resume
    type's key skills."""
    # Every place each skill (or another name for it) appears.
    spans: list[tuple[int, int, str]] = [
        (m.start(), m.end(), skill)
        for skill in SKILLS
        if skill not in _SOFT
        for term in (skill, *_EQUIVALENTS.get(skill, []))
        for m in _pattern(term).finditer(resume_text)
    ]

    # "Azure" inside "Azure AD" is the longer skill's mention, not its own.
    def inside_another(a: tuple[int, int, str]) -> bool:
        return any(
            b[2] != a[2]
            and b[0] <= a[0]
            and a[1] <= b[1]
            and (b[1] - b[0]) > (a[1] - a[0])
            for b in spans
        )

    first: dict[str, tuple[int, int]] = {}
    for span in sorted(spans):
        if span[2] not in first and not inside_another(span):
            first[span[2]] = (span[0], span[1])
    found: list[str] = []
    seen: set[str] = set()
    for begin, finish in sorted(first.values()):
        written = " ".join(resume_text[begin:finish].split())
        if written.lower() not in seen:
            seen.add(written.lower())
            found.append(written)
    return found[:limit]


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
