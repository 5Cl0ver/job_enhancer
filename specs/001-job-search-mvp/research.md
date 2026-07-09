# Research Findings: Job Search Assistant MVP

**Date**: 2026-05-29 | **Branch**: `001-job-search-mvp`

All NEEDS CLARIFICATION items from Technical Context resolved below.

---

## 1. NVIDIA NIM API Integration

**Decision**: Use `langchain-nvidia-ai-endpoints` (`ChatNVIDIA`) as the LLM
client in the FastAPI backend.

**Rationale**: Already using LangChain for orchestration. `ChatNVIDIA` supports
`.ainvoke()` for FastAPI async, streaming, and structured output. Switching
models is one string change. OpenAI SDK with custom `base_url` is the fallback
if LangChain dependency is ever dropped.

**Alternatives considered**:
- Raw `openai` SDK — viable, but loses LangChain chain/prompt benefits.
- NVIDIA Python SDK — not necessary; OpenAI-compatible endpoint covers all
  needs.

**Key findings**:

| Item | Value |
|------|-------|
| Base URL | `https://integrate.api.nvidia.com/v1` |
| Auth header | `Authorization: Bearer nvapi-...` |
| Primary model | `meta/llama-3.3-70b-instruct` (best free-tier speed/quality) |
| Fallback model | `nvidia/llama-3.3-nemotron-super-49b-v1.5` (NVIDIA-tuned) |
| Free tier RPM | ~40 requests/minute (can apply to upgrade to 200 RPM, free) |
| Token limits | None — rate limit only, no token quota |
| Error handling | Catch 429, respect `Retry-After` header, exponential backoff |

**Installation**:
```
pip install langchain-nvidia-ai-endpoints
```

**Basic usage**:
```python
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_core.messages import HumanMessage, SystemMessage

llm = ChatNVIDIA(
    model="meta/llama-3.3-70b-instruct",
    api_key=os.environ["NVIDIA_API_KEY"],
    temperature=0.7,
    max_tokens=1024,
)

result = await llm.ainvoke([
    SystemMessage(content="You are an expert resume writer."),
    HumanMessage(content=f"Tailor this resume:\n{resume_text}"),
])
```

**Env var**: `NVIDIA_API_KEY=nvapi-...` (recognized by both LangChain and
OpenAI SDK automatically).

---

## 2. NextAuth.js v5 + FastAPI JWT Validation

**Decision**: Use `fastapi-nextauth-jwt` library for token validation in
FastAPI. Set `session: { strategy: "jwt" }` explicitly in NextAuth config.

**Rationale**: NextAuth v5 issues JWE (encrypted) tokens, not standard signed
JWTs. Standard libraries like `PyJWT` cannot decrypt them. `fastapi-nextauth-jwt`
handles HKDF key derivation and JWE decryption automatically using the shared
`AUTH_SECRET`.

**Alternatives considered**:
- `python-jose` / `PyJWT` — only handle signed JWTs (HS256/RS256), not JWE.
  Would require manual HKDF + JWE implementation.
- Database sessions — avoids the JWT complexity but requires FastAPI to query
  the DB on every request to validate a session ID. Slower and more coupled.

**Key findings**:

| Item | Value |
|------|-------|
| Token format | JWE (encrypted), NOT signed JWT |
| Encryption algorithm | A256CBC-HS512 or A256GCM |
| Key derivation | HKDF SHA-256, info = "NextAuth.js Generated Encryption Key" |
| Cookie name (v5) | `authjs.session-token` |
| Library | `fastapi-nextauth-jwt` |
| Required config | `session: { strategy: "jwt" }` (mandatory if using DB adapter) |

**Critical**: If a NextAuth DB adapter is used (e.g., Drizzle/Neon adapter),
v5 defaults to `database` session strategy — no JWT is issued. Always
explicitly set `session: { strategy: "jwt" }`.

**Installation**:
```
pip install fastapi-nextauth-jwt
```

**FastAPI usage**:
```python
from typing import Annotated
from fastapi import Depends
from fastapi_nextauth_jwt import NextAuthJWT

JWT = NextAuthJWT(secret=settings.AUTH_SECRET)

@router.get("/protected")
async def route(jwt: Annotated[dict, Depends(JWT)]):
    user_id = jwt["sub"]
    ...
```

**Secret sharing**: Generate once with `openssl rand -hex 32`. Set identical
value as `AUTH_SECRET` in both Next.js and FastAPI environments.

**v4 → v5 breaking changes relevant to this project**:

| Item | v4 | v5 |
|------|----|----|
| Cookie name | `next-auth.session-token` | `authjs.session-token` |
| Config type | `NextAuthOptions` | `NextAuthConfig` |
| Session strategy | jwt (default, no adapter) | database (default with adapter) |
| Adapter packages | `@next-auth/*-adapter` | `@auth/*-adapter` |
| Server session | `getServerSession(authOptions)` | `auth()` |

---

## 3. Job APIs: Adzuna + JSearch

**Decision**: Adzuna as primary source (generous free tier), JSearch as
supplemental source with aggressive caching (200 req/month hard limit).

**Rationale**: Adzuna provides high volume with no hard published cap. JSearch
provides richer data (full descriptions, direct apply URLs) but is severely
limited on free tier. Combining both maximizes coverage while respecting
rate limits.

**Alternatives considered**:
- Playwright scraping — fragile, ToS risk, maintenance overhead. Deferred to
  future enhancement only.
- LinkedIn/Indeed APIs — require enterprise agreements or are deprecated.

### Adzuna

| Item | Value |
|------|-------|
| Base URL | `https://api.adzuna.com/v1/api/jobs/` |
| Auth | Query params: `app_id` + `app_key` |
| Registration | Free at developer.adzuna.com, no credit card |
| Free tier | Unspecified / generous (thousands of req/day reported) |
| Countries | 12 (gb, us, au, de, fr, ca, nl, sg, nz, za, in, br) |
| Description | Snippet only (~200 chars) |
| Apply URL | Adzuna redirect (not direct employer URL) |
| Salary fields | `salary_min`, `salary_max` |

**Search endpoint**:
```
GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
    ?app_id=...&app_key=...
    &what={title_keywords}
    &where={location}
    &results_per_page=20
    &sort_by=date
```

### JSearch (RapidAPI)

| Item | Value |
|------|-------|
| Base URL | `https://jsearch.p.rapidapi.com` |
| Auth | Header: `x-rapidapi-key` + `x-rapidapi-host` |
| Free tier | 200 req/month (hard), 1,000 req/hour within quota |
| Description | Full text |
| Apply URL | Direct employer URL |
| Salary fields | `job_min_salary`, `job_max_salary` |
| Extra data | `job_required_skills`, `job_required_experience` |

**Search endpoint**:
```
GET https://jsearch.p.rapidapi.com/search
    ?query={title}+in+{location}
    &page=1&num_pages=1
```

### Normalized job schema (after API aggregation)

Both APIs map to a single internal `JobListing` schema:

```python
class JobListingCreate(BaseModel):
    external_id: str          # "{source}:{original_id}"
    source: str               # "adzuna" | "jsearch"
    title: str
    company: str
    location: str
    description: str          # snippet or full
    salary_min: int | None
    salary_max: int | None
    currency: str | None      # default "USD"
    job_type: str | None      # "full_time" | "part_time" | "contract"
    is_remote: bool
    apply_url: str
    posted_at: datetime | None
    content_hash: str         # deduplication hash (auto-computed)
    company_normalized: str   # for fuzzy dedup index (auto-computed)
    title_normalized: str     # for fuzzy dedup index (auto-computed)
```

---

## 4. Neon PostgreSQL + Async SQLAlchemy

**Decision**: Use asyncpg driver with the Neon PgBouncer pooler hostname.
Set `prepared_statement_cache_size=0` (required for PgBouncer transaction mode).

**Rationale**: Neon's serverless architecture uses ephemeral compute; the
PgBouncer pooler endpoint provides stable connections. PgBouncer transaction
mode requires disabling prepared statement caching.

**Alternatives considered**:
- Direct connection (no pooler) — risk of exhausting Neon free-tier connection
  limit (10 total) under concurrent Railway workers.
- psycopg3 async — valid alternative, but asyncpg is more widely tested with
  SQLAlchemy 2.x async.

**Engine setup**:
```python
# app/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,  # uses -pooler hostname
    connect_args={
        "ssl": "require",
        "prepared_statement_cache_size": 0,  # PgBouncer transaction mode
    },
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=settings.DEBUG,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

**Connection string format**:
```
postgresql+asyncpg://user:password@ep-xxx-pooler.us-east-1.aws.neon.tech/dbname
```

**Alembic env.py**: Use `async_engine_from_config` with `NullPool` for
migrations (see research data-model section for full pattern).

---

## 5. Job Deduplication Strategy

**Decision**: Two-phase deduplication — exact SHA-256 hash (Phase 1) + rapidfuzz
fuzzy matching (Phase 2).

**Rationale**: Exact hashing catches identical re-posts at zero CPU cost via
DB unique constraint. Fuzzy matching catches near-duplicates (variant company
name formatting, slightly different job titles) using company + title score
with permissive location handling.

**Alternatives considered**:
- ML embedding similarity — overkill for 50-100 user scale; adds latency and
  cost.
- Only exact hash — misses "Google LLC" vs "Google" type duplicates.
- fuzzywuzzy/thefuzz — same API, but effectively deprecated; rapidfuzz is 10-100x
  faster (C++ backend).

**Library**: `rapidfuzz` (MIT license, actively maintained)

**Thresholds**:
- Job title: `token_sort_ratio >= 88` (handles word reordering, minor typos)
- Company name: `token_sort_ratio >= 85` (handles "LLC", "Inc" variants)
- Location: permissive — remote treated as compatible with any location;
  city names fuzzy matched at >= 80

**Implementation**:
```python
# services/dedup.py
import re, hashlib
from rapidfuzz import fuzz, utils

def normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    return re.sub(r"\s+", " ", text)

def job_content_hash(company: str, title: str, location: str) -> str:
    key = "|".join([normalize(company), normalize(title), normalize(location)])
    return hashlib.sha256(key.encode()).hexdigest()

REMOTE_KEYWORDS = {"remote", "anywhere", "distributed", "work from home", "wfh"}

def is_remote(loc: str) -> bool:
    return any(kw in normalize(loc) for kw in REMOTE_KEYWORDS)

def is_duplicate(new: dict, existing: dict) -> bool:
    company_score = fuzz.token_sort_ratio(
        new["company"], existing["company"],
        processor=utils.default_process,
    )
    title_score = fuzz.token_sort_ratio(
        new["title"], existing["title"],
        processor=utils.default_process,
    )
    loc_a, loc_b = new["location"], existing["location"]
    if is_remote(loc_a) or is_remote(loc_b):
        location_ok = True
    else:
        location_ok = fuzz.token_sort_ratio(
            normalize(loc_a), normalize(loc_b),
            processor=utils.default_process,
        ) >= 80
    return company_score >= 85 and title_score >= 88 and location_ok
```

**DB schema support**:
- `content_hash VARCHAR(64) UNIQUE` — Phase 1 exact match
- Composite index on `(company_normalized, title_normalized)` — narrows
  Phase 2 candidate set before fuzzy comparison

---

## Summary of All Decisions

| Area | Decision |
|------|----------|
| AI SDK | `langchain-nvidia-ai-endpoints` (`ChatNVIDIA`) |
| AI model | `meta/llama-3.3-70b-instruct` (free tier primary) |
| Auth validation | `fastapi-nextauth-jwt` library |
| Session strategy | `jwt` (explicit in NextAuth config) |
| Primary job API | Adzuna |
| Supplemental job API | JSearch (cache aggressively, 200 req/month) |
| DB driver | asyncpg via SQLAlchemy 2.x async |
| DB connection | Neon PgBouncer pooler endpoint |
| Dedup strategy | SHA-256 hash + rapidfuzz fuzzy matching |
| Dedup library | rapidfuzz (token_sort_ratio) |
