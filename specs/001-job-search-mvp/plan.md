# Implementation Plan: Job Search Assistant MVP

**Branch**: `001-job-search-mvp` | **Date**: 2026-05-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-job-search-mvp/spec.md`

## Summary

Build a full-stack job search assistant that aggregates listings from external
job APIs (Adzuna, JSearch), lets users save/organize/track applications on a
Kanban board, and uses NVIDIA-hosted LLMs to tailor resumes and generate cover
letters (AI is the final build phase). Deployed publicly on Vercel (frontend) +
Render free tier (backend) + Supabase (database + auth + file storage) for a
real user base of ~50-100 concurrent users. Hosting must be $0/month
(hard requirement, decided 2026-07-14; replaces the original Railway + Neon +
NextAuth stack — Railway no longer has a free tier).

## Technical Context

**Language/Version**:
- TypeScript 5.x (frontend, Next.js 15)
- Python 3.11+ (backend, FastAPI)

**Primary Dependencies**:
- Frontend: Next.js 15, Tailwind CSS, shadcn/ui, TanStack Query v5,
  Supabase Auth (@supabase/supabase-js + @supabase/ssr), Zod
- Backend: FastAPI, SQLAlchemy 2.x (async), Alembic, asyncpg, Pydantic v2,
  LangChain, python-jose, httpx, rapidfuzz
- AI: NVIDIA NIM API (OpenAI-compatible endpoint, free tier)
- Job APIs: Adzuna Jobs API, JSearch via RapidAPI
- PDF: pdfplumber (parse uploaded resumes), reportlab or weasyprint (generate
  PDF output)

**Storage**: PostgreSQL 15 via Supabase (free tier, Supavisor pooling); Supabase also provides Auth (email/password + Google + GitHub OAuth) and file Storage (resume uploads, AI phase)

**Testing**:
- Frontend: Vitest + React Testing Library, Playwright (E2E)
- Backend: pytest + pytest-asyncio + httpx (async test client)

**Target Platform**: Linux server (Render free tier, Docker) + Vercel Edge (Next.js)

**Project Type**: Full-stack web application (Next.js frontend + FastAPI backend)

**Performance Goals**:
- Job search results appear within 3 seconds of query
- AI resume/cover letter generation completes within 15 seconds
- Page load under 2 seconds (constitutionally mandated)
- Dashboard renders in under 1 second on repeat visits (TanStack Query cache)

**Constraints**:
- Free-tier hosting only (Vercel hobby, Render free, Supabase free) — $0/month is a hard requirement
- Render free instance sleeps after 15 min idle; Supabase free pauses after 7 idle days — both mitigated by a scheduled keep-alive ping (GitHub Actions cron / UptimeRobot)
- AI features (US4) are the FINAL build phase — everything else ships and deploys first
- NVIDIA NIM free tier rate limits (see research.md for specifics)
- Supabase: use connection pooler (Supavisor, transaction mode) — keep `prepared_statement_cache_size=0`, pool_size=5 max
- No native mobile app; responsive web only
- Admin role limited to single owner account; no self-service admin

**Scale/Scope**:
- ~50-100 concurrent users
- 6 user stories across 3 priority levels (P1: US1+US2, P2: US3+US4, P3:
  US5+US6)
- ~21 functional requirements
- 6 core entities: User, JobListing, Collection, SavedJob, Resume,
  GeneratedDocument

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Portfolio-Grade Quality | PASS | Conventional commits enforced; ESLint/Prettier + Ruff configured from day 1; README with screenshots required before launch |
| II. User-Centric Design | PASS | P1 stories (search, save) deliver immediate value; WCAG 2.1 AA targeted; performance SC-001 through SC-006 are user-facing metrics |
| III. AI-Powered Intelligence | PASS | NVIDIA NIM for resume/cover letter; graceful degradation when AI unavailable (SC-008); prompt versioning in source control |
| IV. Security and Privacy | PASS | Supabase Auth (email/password + OAuth) with JWT validation in FastAPI; input validation at every boundary (Zod frontend, Pydantic backend); secrets in env vars only; account deletion FR-020 |
| V. Test-Driven Confidence | PASS | pytest for all API endpoints; Vitest for components; Playwright for critical user flows |
| VI. Clean Architecture | PASS | Next.js ↔ FastAPI via documented OpenAPI contracts; data access layer in FastAPI services; TanStack Query for client state |
| VII. Simplicity and Pragmatism | PASS | MVP ships P1 stories first; no premature abstractions; YAGNI enforced |

**Gate result**: PASS — all 7 principles satisfied. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-job-search-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── openapi.yml      # FastAPI endpoint contracts
│   └── frontend-api.md  # Next.js → FastAPI call patterns
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Settings (env vars, Pydantic BaseSettings)
│   ├── database.py             # Async SQLAlchemy engine + session factory
│   ├── models/                 # SQLAlchemy ORM models
│   │   ├── user.py
│   │   ├── job_listing.py
│   │   ├── collection.py
│   │   ├── saved_job.py
│   │   ├── resume.py
│   │   └── generated_document.py
│   ├── schemas/                # Pydantic request/response schemas
│   │   ├── user.py
│   │   ├── job.py
│   │   ├── collection.py
│   │   ├── saved_job.py
│   │   ├── resume.py
│   │   └── document.py
│   ├── api/                    # FastAPI routers
│   │   ├── v1/
│   │   │   ├── auth.py         # JWT validation middleware
│   │   │   ├── jobs.py         # Job search + deduplication
│   │   │   ├── collections.py  # Save/organize jobs
│   │   │   ├── tracker.py      # Pipeline stage management
│   │   │   ├── ai.py           # Resume + cover letter generation
│   │   │   ├── users.py        # Account self-service
│   │   │   └── admin.py        # Admin dashboard endpoints
│   │   └── router.py
│   ├── services/               # Business logic layer
│   │   ├── job_search.py       # Adzuna + JSearch aggregation + dedup
│   │   ├── ai_service.py       # NVIDIA NIM integration via LangChain
│   │   ├── resume_parser.py    # pdfplumber + docx2txt
│   │   └── admin_service.py    # Health checks, user stats
│   └── middleware/
│       └── auth.py             # Supabase JWT validation dependency
├── alembic/                    # Database migrations
│   ├── env.py
│   └── versions/
├── tests/
│   ├── api/                    # Integration tests per router
│   ├── services/               # Unit tests for business logic
│   └── conftest.py
├── pyproject.toml
└── Dockerfile

frontend/
├── src/
│   ├── app/                    # Next.js 15 App Router
│   │   ├── (auth)/             # Auth routes (login, register)
│   │   ├── (dashboard)/        # Protected routes
│   │   │   ├── search/         # US1: Job search
│   │   │   ├── saved/          # US2: Collections
│   │   │   ├── tracker/        # US3: Kanban board
│   │   │   ├── ai-apply/       # US4: AI quick apply
│   │   │   ├── analytics/      # US5: User analytics
│   │   │   └── admin/          # US6: Admin dashboard
│   │   └── auth/callback/      # Supabase auth callback route
│   ├── components/
│   │   ├── ui/                 # shadcn/ui base components
│   │   ├── jobs/               # JobCard, JobList, SearchBar, Filters
│   │   ├── tracker/            # KanbanBoard, PipelineStage, JobCard
│   │   ├── ai/                 # ResumeUpload, GeneratedDoc, EditPanel
│   │   └── admin/              # HealthPanel, UserTable, StatsChart
│   ├── lib/
│   │   ├── api/                # TanStack Query hooks + fetch wrappers
│   │   ├── supabase.ts         # Supabase browser/server clients (auth)
│   │   └── utils.ts
│   ├── types/                  # Shared TypeScript types
│   └── hooks/                  # Custom React hooks
├── tests/
│   ├── components/             # Vitest + RTL
│   └── e2e/                    # Playwright
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

**Structure Decision**: Option 2 (Web application) — separate `backend/` and
`frontend/` directories at repo root. FastAPI serves the REST API; Next.js
handles all UI and client-side state. Communication exclusively through
OpenAPI-documented endpoints.

## Complexity Tracking

No constitution violations. No justification required.
