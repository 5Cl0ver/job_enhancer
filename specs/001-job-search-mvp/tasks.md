# Tasks: Job Search Assistant MVP

**Input**: Design documents from `specs/001-job-search-mvp/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Tests**: Not included by default. Add test tasks per story when TDD is requested.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency)
- **[Story]**: US1–US6 maps to spec.md user stories
- All file paths are relative to the repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create monorepo structure, initialize both projects, configure tooling.

- [x] T001 Create top-level directory structure: `backend/`, `frontend/`, `docs/`, `.github/workflows/`
- [x] T002 Initialize Python project: create `backend/pyproject.toml` with FastAPI, SQLAlchemy 2.x (async), asyncpg, Alembic, Pydantic v2, python-jose, fastapi-nextauth-jwt, langchain-nvidia-ai-endpoints, langchain-core, rapidfuzz, pdfplumber, python-docx, httpx, slowapi, weasyprint, APScheduler, pytest, pytest-asyncio
- [x] T003 [P] Initialize Next.js 15 project in `frontend/` with TypeScript strict mode, Tailwind CSS, shadcn/ui, TanStack Query v5, NextAuth.js v5, Zod (`npx create-next-app@latest`); then install additional packages: `@dnd-kit/core @dnd-kit/sortable recharts openapi-typescript`
- [x] T004 [P] Configure backend linting: create `backend/pyproject.toml` Ruff config (lint + format rules), add `backend/.pre-commit-config.yaml`
- [x] T005 [P] Configure frontend linting: create `frontend/.eslintrc.json` (Next.js + TypeScript strict), `frontend/prettier.config.ts`
- [x] T006 Create `.env.example` at repo root documenting all required variables: `DATABASE_URL`, `AUTH_SECRET`, `NVIDIA_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `NEXT_PUBLIC_API_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- [x] T007 [P] Create `backend/Dockerfile` (Railway deployment): Python 3.11 slim, install system deps (`libcairo2 libpango-1.0-0 libpangocairo-1.0-0` for weasyprint), install Python deps, run with uvicorn
- [x] T008 [P] Create `frontend/vercel.json` and `frontend/next.config.ts` with `NEXT_PUBLIC_API_URL` env var reference

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Backend Foundation

- [x] T009 Create `backend/app/config.py` using Pydantic `BaseSettings`: load `DATABASE_URL`, `AUTH_SECRET`, `NVIDIA_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JSEARCH_API_KEY`, `DEBUG`, `ALLOWED_ORIGINS`
- [x] T010 Create `backend/app/database.py`: async SQLAlchemy engine (asyncpg + Neon PgBouncer settings: `prepared_statement_cache_size=0`, `pool_size=5`, `max_overflow=5`, `pool_pre_ping=True`), `AsyncSessionLocal`, `get_db` dependency
- [x] T011 Create `backend/app/models/__init__.py` with SQLAlchemy `DeclarativeBase` subclass and `Base`
- [x] T012 [P] Create `backend/app/models/user.py`: `User` model with `id` (UUID PK), `email` (unique), `name`, `image`, `role` (default `user`), `email_verified`, `follow_up_days` (default 7), `created_at`, `updated_at`, `deleted_at`
- [x] T013 Initialize Alembic at `backend/alembic/`: run `alembic init alembic`, configure `backend/alembic/env.py` for async SQLAlchemy (use `async_engine_from_config` + `NullPool`), set `target_metadata = Base.metadata`
- [x] T014 Generate and apply initial Alembic migration for `users` table: `alembic revision --autogenerate -m "create users table"`, verify SQL output
- [x] T015 Create `backend/app/middleware/auth.py`: `NextAuthJWT` dependency from `fastapi-nextauth-jwt`, expose `get_current_user` FastAPI dependency that resolves `User` from DB by `jwt["sub"]` email
- [x] T016 Create `backend/app/main.py`: FastAPI app with lifespan context, CORS middleware (origins from `settings.ALLOWED_ORIGINS`), mount `api/v1/router`, configure error handlers for 422 and 500
- [x] T017 [P] Create `backend/app/api/v1/router.py`: aggregate all v1 sub-routers under `/v1` prefix
- [x] T018 [P] Create `backend/app/schemas/user.py`: `UserProfile`, `UserUpdate` Pydantic models matching `contracts/openapi.yml`

### Frontend Foundation

- [x] T019 Create `frontend/src/lib/auth.ts`: NextAuth v5 config with `session: { strategy: "jwt" }`, Google + GitHub OAuth providers (email/password omitted from MVP — OAuth-only per scope decision), callbacks for `jwt` and `session` to pass user role through
- [x] T019a [P] Generate TypeScript API types from OpenAPI spec: add `prebuild` script to `frontend/package.json` — `"prebuild": "openapi-typescript specs/001-job-search-mvp/contracts/openapi.yml -o src/types/api.d.ts"` — and run once to create `frontend/src/types/api.d.ts`
- [x] T020 [P] Create `frontend/src/app/api/auth/[...nextauth]/route.ts`: export `GET` and `POST` handlers from auth config
- [x] T021 [P] Create `frontend/src/app/(dashboard)/layout.tsx`: server component that calls `auth()`, redirects to `/login` if no session, wraps children in sidebar + navbar layout
- [x] T022 [P] Create `frontend/src/app/(auth)/login/page.tsx`: sign-in page with Google + GitHub OAuth buttons using `signIn()`
- [x] T023 Create `frontend/src/lib/api/client.ts`: async fetch wrapper that retrieves session token via `getToken({ req, raw: true })` and adds `Authorization: Bearer <token>` header, handles 401 redirect
- [x] T024 [P] Wrap `frontend/src/app/layout.tsx` with `<SessionProvider>` and TanStack `<QueryClientProvider>` (create `frontend/src/providers.tsx`)
- [x] T025 [P] Add shadcn/ui base components to `frontend/src/components/ui/`: run `npx shadcn@latest add button card badge input select dropdown-menu dialog toast skeleton`
- [x] T026 [P] Create `frontend/src/components/layout/Navbar.tsx` (user avatar, sign-out) and `frontend/src/components/layout/Sidebar.tsx` (nav links: Search, Saved, Tracker, AI Apply, Analytics)

**Checkpoint**: Auth flow works end-to-end. Authenticated user can reach `/` dashboard shell. Backend `/v1/users/me` returns user profile.

---

## Phase 3: User Story 1 — Search and Discover Jobs (P1) 🎯 MVP

**Goal**: Authenticated users can search jobs from Adzuna + JSearch, filter results, and view listings — all deduplicated.

**Independent Test**: Sign in → search `"Python Developer"` in `"New York"` → results appear within 3 seconds with no duplicate listings.

### Implementation

- [x] T027 [P] [US1] Create `backend/app/models/job_listing.py`: `JobListing` model with all fields from data-model.md (`content_hash` unique, `company_normalized`, `title_normalized`, `external_id` unique, `is_expired`)
- [x] T028 [P] [US1] Create `backend/app/schemas/job.py`: `JobListing`, `JobSearchResponse`, `PaginatedMeta` Pydantic schemas
- [x] T029 [P] [US1] Create `backend/app/services/dedup.py`: `normalize()`, `job_content_hash()`, `is_duplicate()` using `rapidfuzz.fuzz.token_sort_ratio` (title threshold=88, company=85, location permissive for remote)
- [x] T030 [US1] Create `backend/app/services/job_search.py`: `search_adzuna()` fetcher (app_id + app_key query params), `search_jsearch()` fetcher (x-rapidapi-key header), `aggregate_and_deduplicate()` that merges results, calls `dedup.py`, upserts into DB via `content_hash` unique constraint
- [x] T031 [US1] Create `backend/app/api/v1/jobs.py`: `GET /jobs/search` endpoint with query params (`q`, `location`, `remote`, `salary_min`, `salary_max`, `job_type`, `page`, `per_page`), calls `job_search.py`, returns `JobSearchResponse`
- [x] T032 [US1] Generate and apply Alembic migration for `job_listings` table: include unique constraints and indexes (`content_hash`, `external_id`, `(company_normalized, title_normalized)`, `posted_at DESC`)
- [x] T033 [P] [US1] Create `frontend/src/components/jobs/SearchBar.tsx`: controlled input for title/keywords + location field, Search button, loading state
- [x] T034 [P] [US1] Create `frontend/src/components/jobs/SearchFilters.tsx`: Remote toggle, salary range inputs, job type select (full_time/part_time/contract)
- [x] T035 [P] [US1] Create `frontend/src/components/jobs/JobCard.tsx`: displays title, company, location, salary range (or "Not disclosed"), source badge (Adzuna/JSearch), "Remote" tag, relative posted date, "Save" button stub
- [x] T036 [P] [US1] Create `frontend/src/components/jobs/JobDetail.tsx`: expanded drawer/modal with full description, highlighted requirements, apply button linking to `apply_url`
- [x] T037 [US1] Create `frontend/src/lib/api/jobs.ts`: `useJobSearch(params)` TanStack Query hook with debounce (300ms), cache `staleTime: 5 * 60 * 1000`
- [x] T038 [US1] Create `frontend/src/app/(dashboard)/search/page.tsx`: wire `SearchBar` + `SearchFilters` → `useJobSearch` → `JobCard` list, show skeleton loaders, empty state, error state

**Checkpoint**: US1 fully functional. Job search returns real data. No duplicate listings appear. Filters work. Can stop here for MVP demo.

---

## Phase 4: User Story 2 — Save and Organize Jobs (P1)

**Goal**: Users can save jobs, create named collections, and organize jobs between them — persisted across sessions.

**Independent Test**: Save a job → create "Dream Jobs" collection → move job → log out → log back in → job still in "Dream Jobs".

### Implementation

- [x] T039 [P] [US2] Create `backend/app/models/collection.py`: `Collection` model (`user_id` FK cascade, `name`, `color`, `sort_order`, `is_default`)
- [x] T040 [P] [US2] Create `backend/app/models/saved_job.py`: `SavedJob` model with `UNIQUE (user_id, job_listing_id)`, FKs to `Collection` and `PipelineStage` (nullable)
- [x] T041 [P] [US2] Create `backend/app/schemas/collection.py` + `backend/app/schemas/saved_job.py`: all request/response shapes from openapi.yml
- [x] T042 [P] [US2] Create `backend/app/services/collections.py`: `create_default_collection()`, CRUD operations, enforce `UNIQUE (user_id, name)`, block deletion of default collection
- [x] T043 [P] [US2] Create `backend/app/services/saved_jobs.py`: `save_job()` (check duplicate via UNIQUE constraint), `update_saved_job()`, `delete_saved_job()`, `list_saved_jobs()` with filters
- [x] T044 [US2] Create `backend/app/api/v1/collections.py`: full CRUD endpoints per openapi.yml, require auth
- [x] T045 [US2] Create `backend/app/api/v1/saved_jobs.py`: `POST /saved-jobs`, `GET /saved-jobs`, `PATCH /saved-jobs/{id}`, `DELETE /saved-jobs/{id}`
- [x] T046 [US2] Generate and apply Alembic migrations for `collections` + `saved_jobs` tables
- [x] T047 [US2] Update `backend/app/services/users.py`: `create_user()` helper that creates User + seeds default Collection on first OAuth login (called from auth middleware on unknown `sub`)
- [x] T048 [P] [US2] Create `frontend/src/components/jobs/SaveButton.tsx`: toggle save/unsave, optimistic UI update via TanStack Query mutation
- [x] T049 [P] [US2] Create `frontend/src/components/jobs/CollectionSidebar.tsx`: list of collections with job counts, "New Collection" dialog, drag-to-move support
- [x] T050 [US2] Create `frontend/src/lib/api/collections.ts` + `frontend/src/lib/api/saved_jobs.ts`: all TanStack Query hooks (useCollections, useCreateCollection, useSaveJob, useUpdateSavedJob, etc.)
- [x] T051 [US2] Create `frontend/src/app/(dashboard)/saved/page.tsx`: sidebar with `CollectionSidebar` + main area with saved jobs grid, move-to-collection context menu, archive action

**Checkpoint**: US1 + US2 complete. Users can discover and organize jobs.

---

## Phase 5: User Story 3 — Track Application Status (P2)

**Goal**: Users track applications on a Kanban board with 8 default stages + custom stages. Follow-up reminders show for stale applications.

**Independent Test**: Save a job → move to "Applied" → view `/tracker` → appears in "Applied" column → create "Coding Challenge" custom stage → move job to it → stage persists.

### Implementation

- [x] T052 [P] [US3] Create `backend/app/models/pipeline_stage.py`: `PipelineStage` model (`user_id` FK cascade, `name`, `sort_order`, `is_default`, `color`)
- [x] T053 [P] [US3] Create `backend/app/schemas/pipeline_stage.py`: `PipelineStage`, `PipelineStageCreate` schemas
- [x] T054 [P] [US3] Create `backend/app/services/tracker.py`: `seed_default_stages()` (8 default stages per data-model.md), stage CRUD, block deletion of `is_default=true` stages, `move_job_to_stage()` (updates `last_stage_change`, sets `applied_at` once when stage name is "Applied")
- [x] T055 [US3] Create `backend/app/api/v1/tracker.py`: `GET/POST /pipeline-stages`, `PATCH/DELETE /pipeline-stages/{id}`, `GET /saved-jobs?follow_up_overdue=true` (query jobs where `last_stage_change < now() - follow_up_days`)
- [x] T056 [US3] Generate and apply Alembic migration for `pipeline_stages` table; update `saved_jobs` migration to add `pipeline_stage_id` FK
- [x] T057 [US3] Update `backend/app/services/users.py` `create_user()` to also call `seed_default_stages()` **[depends on T047 — users.py must exist first]**
- [x] T058 [P] [US3] Create `frontend/src/components/tracker/KanbanBoard.tsx`: renders columns per stage, uses `@dnd-kit/core` for drag-and-drop between stages
- [x] T059 [P] [US3] Create `frontend/src/components/tracker/PipelineColumn.tsx`: column header with stage name + count, droppable area, "Add Stage" button in last column
- [x] T060 [P] [US3] Create `frontend/src/components/tracker/KanbanCard.tsx`: company logo, title, company, days-since-applied, follow-up indicator badge
- [x] T061 [US3] Create `frontend/src/lib/api/tracker.ts`: `usePipelineStages()`, `useKanbanJobs()`, `useMoveJobStage()` mutation, `useCreateStage()`, `useDeleteStage()`
- [x] T062 [US3] Create `frontend/src/app/(dashboard)/tracker/page.tsx`: `KanbanBoard` with all stages, drag-to-move calls `useMoveJobStage`, "Add Stage" modal
- [x] T062a [P] [US3] Add follow-up reminder badge to `frontend/src/components/tracker/KanbanCard.tsx`: display amber indicator when `last_stage_change` exceeds `user.follow_up_days`; add aria-label "Follow-up overdue" for screen readers

**Checkpoint**: US1 + US2 + US3 complete. Core job tracking workflow end-to-end.

---

## Phase 6: User Story 4 — AI-Assisted Quick Apply (P2)

**Goal**: Users upload a base resume; AI generates tailored resumes and cover letters for specific jobs within 15 seconds. Output is editable and downloadable as PDF.

**Independent Test**: Upload a PDF resume → select a saved job → "Optimize Resume" → AI response within 15 seconds mentioning skills from job description → edit text → download PDF.

### Implementation

- [x] T063 [P] [US4] Create `backend/app/models/resume.py`: `Resume` model (`user_id` FK, `filename`, `file_size`, `mime_type`, `storage_path`, `parsed_text`, `is_active`)
- [x] T064 [P] [US4] Create `backend/app/models/generated_document.py`: `GeneratedDocument` model (`saved_job_id` FK, `resume_id` FK, `document_type`, `content`, `edited_content`, `pdf_path`, `model_used`, `generation_ms`, `version`)
- [x] T065 [P] [US4] Create `backend/app/schemas/resume.py` + `backend/app/schemas/document.py`: all schemas per openapi.yml
- [x] T066 [P] [US4] Create `backend/app/services/resume_parser.py`: `parse_resume_pdf()` using `pdfplumber`, `parse_resume_docx()` using `python-docx`; return plain text string
- [x] T067 [P] [US4] Create `backend/app/services/ai_service.py`: `ChatNVIDIA` client (`langchain-nvidia-ai-endpoints`) with `model="meta/llama-3.3-70b-instruct"`; `generate_tailored_resume(resume_text, job_description)` and `generate_cover_letter(resume_text, job_description, company, title)` async methods; catch `RateLimitError` (429) and raise `HTTPException(429)` with `Retry-After` header; log `model_used` and `generation_ms`
- [x] T068 [US4] Create `backend/app/api/v1/ai.py`: `POST /resumes` (multipart upload, validate mime_type + size ≤10MB, parse text, save to volume), `GET /resumes`, `POST /ai/generate`, `GET /ai/documents/{id}`, `PATCH /ai/documents/{id}`, `GET /ai/documents/{id}/pdf` (render with `weasyprint`)
- [x] T069 [US4] Generate and apply Alembic migrations for `resumes` + `generated_documents` tables
- [x] T070 [P] [US4] Create `frontend/src/components/ai/ResumeUpload.tsx`: drag-drop zone, file type validation (PDF/DOCX), size check, upload progress bar, active resume indicator
- [x] T071 [P] [US4] Create `frontend/src/components/ai/GeneratedDocViewer.tsx`: tabbed view (Resume / Cover Letter), inline `<textarea>` for editing, character count
- [x] T072 [P] [US4] Create `frontend/src/components/ai/DocumentControls.tsx`: "Regenerate" button with emphasis input, "Download PDF" button, "Copy to clipboard" button
- [x] T073 [US4] Create `frontend/src/lib/api/ai.ts`: `useUploadResume()`, `useGenerateDocument()` mutation, `useGeneratedDocument(id)`, `useUpdateDocument()` mutation
- [x] T074 [US4] Create `frontend/src/app/(dashboard)/ai-apply/page.tsx`: job selector (from saved jobs), active resume display + upload CTA, generate buttons, `GeneratedDocViewer` + `DocumentControls`, 15s timeout progress bar, graceful "AI unavailable" fallback message
- [x] T074a [P] [US4] Add AI usage indicator to `frontend/src/components/ai/GeneratedDocViewer.tsx`: display model name (from `model_used`) and generation time (from `generation_ms`) below each generated document — satisfies Constitution Principle III (AI transparency)
- [x] T075 [US4] Add AI unavailability handling to `frontend/src/app/(dashboard)/search/page.tsx` and tracker: show toast if AI request fails, all other features remain accessible

**Checkpoint**: US1–US4 complete. Full core product functional. AI features with graceful degradation.

---

## Phase 7: User Story 5 — User Dashboard and Analytics (P3)

**Goal**: Users see a summary of their job search progress with stats and activity trends.

**Independent Test**: With 5+ saved jobs in various stages → navigate to `/analytics` → see correct counts for total saved, applied, in-interview; activity trend chart renders.

### Implementation

- [x] T076 [P] [US5] Create `backend/app/api/v1/analytics.py`: `GET /analytics/summary` — aggregate query over `SavedJob` and `PipelineStage` for current user: total saved, applied count, interview count, response rate, applications per week (last 8 weeks)
- [x] T077 [P] [US5] Create `frontend/src/components/analytics/StatCard.tsx`: icon + label + value + optional trend arrow
- [x] T078 [P] [US5] Create `frontend/src/components/analytics/ActivityChart.tsx`: bar chart of applications per week using `recharts`
- [x] T079 [US5] Create `frontend/src/lib/api/analytics.ts`: `useAnalyticsSummary()` TanStack Query hook
- [x] T080 [US5] Create `frontend/src/app/(dashboard)/analytics/page.tsx`: grid of `StatCard` (total saved, applied, response rate, interviews) + `ActivityChart`

**Checkpoint**: US1–US5 complete. User-facing product is fully featured.

---

## Phase 8: User Story 6 — Admin Dashboard + Account Management (P3)

**Goal**: Admin monitors platform health and user signups. Users can export and delete their data.

**Independent Test (Admin)**: Sign in as admin → `/admin` → see user count + signup trend + service health indicators. Sign in as regular user → `/admin` → 403 redirect.

**Independent Test (Account)**: `DELETE /v1/users/me` → 204 → re-login fails → shared `JobListing` records still intact.

### Implementation

- [x] T081 [P] [US6] Create `backend/app/services/admin_service.py`: `get_platform_stats()` (total users, active 7d/30d, signups by day), `check_service_health()` (ping NVIDIA `/models`, Adzuna search endpoint, JSearch endpoint, DB latency)
- [x] T082 [US6] Create `backend/app/api/v1/admin.py`: `GET /admin/stats`, `GET /admin/health`, `GET /admin/users` — all protected by admin role check (`jwt["role"] == "admin"` or `user.role == "admin"`)
- [x] T083 [US6] Create `backend/app/api/v1/users.py`: `GET /users/me`, `PATCH /users/me`, `GET /users/me/export` (serialize all user-owned data as JSON), `DELETE /users/me` (cascade delete all owned records, schedule storage file cleanup)
- [x] T084 [P] [US6] Create `frontend/src/components/admin/HealthPanel.tsx`: grid of service status badges (healthy/degraded/down) + latency for Database, NVIDIA API, Adzuna, JSearch
- [x] T085 [P] [US6] Create `frontend/src/components/admin/StatsOverview.tsx`: total users, active users 7d/30d, new signups 7d
- [x] T086 [P] [US6] Create `frontend/src/components/admin/UserTable.tsx`: paginated table of users (email, role, created_at, last active)
- [x] T087 [P] [US6] Create `frontend/src/components/admin/SignupTrendChart.tsx`: line chart of daily signups (last 30 days) using `recharts`
- [x] T088 [US6] Create `frontend/src/lib/api/admin.ts`: `useAdminStats()`, `useServiceHealth()`, `useAdminUsers(page)` TanStack Query hooks
- [x] T089 [US6] Create `frontend/src/app/(dashboard)/admin/page.tsx`: admin role guard (redirect if `session.user.role !== "admin"`), `StatsOverview` + `HealthPanel` + `UserTable` + `SignupTrendChart`
- [x] T090 [US6] Create `frontend/src/app/(dashboard)/settings/page.tsx`: profile edit form (`UserUpdate`), data export download button, account deletion dialog with confirmation ("Type your email to confirm")

**Checkpoint**: Full application complete. All 6 user stories functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Production readiness, security hardening, documentation, deployment.

- [x] T091 [P] Create `backend/tests/conftest.py`: pytest fixtures — async test client (`httpx.AsyncClient` with `app`), test database (in-memory SQLite or Neon test branch), mock auth dependency, factory functions for User/JobListing/SavedJob
- [x] T092 [P] Write backend API integration tests in `backend/tests/api/`: `test_jobs.py` (search, dedup), `test_saved_jobs.py` (save, update stage, delete, duplicate prevention), `test_collections.py` (CRUD, default protection), `test_tracker.py` (stages, default deletion blocked), `test_ai.py` (upload, generate mocked, PDF), `test_users.py` (profile, export, delete cascade), `test_admin.py` (stats, health, 403 non-admin)
- [x] T093 [P] Add API rate limiting to `backend/app/main.py` using `slowapi`: 60 req/min per user on `/v1` routes, 5 req/min per user on `/v1/ai/generate`
- [x] T094 [P] Create `backend/app/services/notifications.py`: follow-up reminder background task using APScheduler (job runs every hour: find `SavedJob` where `last_stage_change < now() - user.follow_up_days` and `follow_up_sent_at` is null or stale; update `follow_up_sent_at`); register scheduler in `backend/app/main.py` lifespan
- [x] T095 [P] Write Playwright E2E tests in `frontend/tests/e2e/`: `auth.spec.ts` (login, redirect), `search.spec.ts` (search, filter, save), `tracker.spec.ts` (Kanban drag-to-move)
- [x] T096 Create `README.md` at repo root: project description, feature overview, demo screenshots, tech stack with rationale, local setup instructions, architecture overview, link to live demo
- [x] T097 [P] Create `docs/architecture.md`: system diagram (Next.js → FastAPI → Neon), data flow for auth (NextAuth JWE → FastAPI JWT validation), AI pipeline (upload → parse → LangChain → NVIDIA NIM → response), deployment topology (Vercel + Railway + Neon)
- [x] T098 [P] Create `.github/workflows/ci.yml`: on push to main/feature branches — backend (Ruff lint, pytest), frontend (ESLint, TypeScript build, Vitest), block merge on failure
- [x] T099 Security audit: verify CORS `allowed_origins` matches production URLs only, confirm all cookies are `HttpOnly` + `Secure` + `SameSite=Lax`, run `pip-audit` on backend deps, run `npm audit` on frontend deps, confirm no secrets in env logs
- [x] T099a [P] WCAG 2.1 AA accessibility audit: review all interactive components in `frontend/src/components/` for aria labels, keyboard navigation, focus rings, and color contrast ratios ≥4.5:1; fix any violations (Constitution Principle II)
- [x] T099b [P] Load test: run k6 or Locust against staging (100 VUs, 5 min) targeting `GET /v1/jobs/search` and `POST /v1/ai/generate`; verify p95 latency under 3s and 15s respectively; document results in `docs/load-test-results.md` (verifies SC-010)
- [x] T100 Add code section manifests: `backend/app/models/MANIFEST.md`, `backend/app/services/MANIFEST.md`, `backend/app/api/MANIFEST.md`, `frontend/src/components/MANIFEST.md` — each listing files, purpose, and dependencies (per project requirement for clear documentation)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundation)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 — safe to start once checkpoint passed
- **Phase 4 (US2)**: Depends on Phase 2 — can start in parallel with Phase 3
- **Phase 5 (US3)**: Depends on Phase 4 (`SavedJob` model) — start after T046
- **Phase 6 (US4)**: Depends on Phase 4 (`SavedJob` FK) — can start after T046
- **Phase 7 (US5)**: Depends on Phases 3+4+5 (needs data from all stories) — start after Phase 5
- **Phase 8 (US6)**: Depends on Phase 2 (User model) — can start in parallel with US1–US5
- **Phase 9 (Polish)**: Depends on all story phases complete

### User Story Dependencies

- **US1 (Search)**: Standalone — only needs Foundation
- **US2 (Save/Organize)**: Standalone — only needs Foundation + US1 JobListing model (T027)
- **US3 (Track)**: Needs `SavedJob` model from US2 (T040)
- **US4 (AI Apply)**: Needs `SavedJob` model from US2 (T040)
- **US5 (Analytics)**: Needs SavedJob + PipelineStage data (US2 + US3 complete)
- **US6 (Admin)**: Only needs Foundation (User model) — independent

### Within Each Phase

- Models before services (`T027` before `T030`)
- Services before routers (`T030` before `T031`)
- Migrations after model creation (`T032` after `T027`)
- Frontend hooks before pages (`T037` before `T038`)
- Backend endpoint before frontend integration

### Parallel Opportunities

Foundation (T009–T026): backend tasks (T009–T018) parallel with frontend tasks (T019–T026)

US1 (Phase 3): T027, T028, T029 parallel → T030 → T031; T033, T034, T035, T036 parallel → T037 → T038

US2 (Phase 4): T039, T040, T041 parallel → T042, T043 parallel → T044, T045 → T046; T048, T049 parallel → T050 → T051

US6 (Phase 8): T081 → T082, T083 parallel; T084, T085, T086, T087 parallel → T088 → T089, T090

---

## Parallel Example: Foundation Phase

```bash
# Backend and frontend foundation can run in parallel:
Task: "T009 backend config, T010 database, T011 models base, T012 User model, T013–T014 Alembic, T015 auth middleware, T016 main.py, T017–T018 router + schemas"
Task: "T019 NextAuth config, T020 auth route, T021 dashboard layout, T022 login page, T023 API client, T024 providers, T025 shadcn components, T026 Navbar/Sidebar"
```

## Parallel Example: US1 Search

```bash
# Backend (T027–T029 parallel):
Task: "T027 JobListing model"
Task: "T028 job schemas"
Task: "T029 dedup service"
# Then sequentially: T030 job_search service → T031 jobs router → T032 migration

# Frontend (T033–T036 parallel):
Task: "T033 SearchBar"
Task: "T034 SearchFilters"
Task: "T035 JobCard"
Task: "T036 JobDetail"
# Then sequentially: T037 API hooks → T038 search page
```

---

## Implementation Strategy

### MVP First (US1 + US2 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundation (CRITICAL)
3. Complete Phase 3: US1 (Search) → **first live demo possible**
4. Complete Phase 4: US2 (Save/Organize) → **usable MVP**
5. Stop and validate: all quickstart.md scenarios for US1+US2 pass
6. Deploy to Vercel + Railway

### Incremental Delivery

1. Setup + Foundation → foundation ready
2. US1 → job search live → demo to friends
3. US2 → save + organize → usable product
4. US3 → Kanban tracker → daily active use
5. US4 → AI apply → key differentiator feature
6. US5 → analytics → polish + portfolio showcase
7. US6 → admin → production operations ready
8. Polish → README, tests, CI → portfolio-ready

### Solo Developer Strategy

Work sequentially by phase. Within each phase, write backend first
(model → service → router → migration), then wire up frontend
(component → hooks → page). Each phase ends with a working,
demonstrable feature increment.

---

## Notes

- `[P]` tasks target different files — safe to run in parallel within the same phase
- `[US?]` label maps each task to its user story for traceability
- Quickstart.md scenarios are the acceptance test for each story checkpoint
- Commit after each task or logical group using conventional commit format
- Stop at any checkpoint to demo or deploy the current increment
- Code section manifests (T100) fulfill the "manifests for each code section" portfolio requirement

---

## Phase 10: Convergence

**Purpose**: Remaining work identified by `/speckit-converge` (2026-07-14) assessing the current codebase against spec.md, plan.md, and tasks.md. Constitution violations first, then ordered by severity.

> **Decision 2026-07-14 (Option A)**: Hosting = Vercel + Render free tier + Supabase (database, auth, file storage) — $0/month hard requirement; Railway/Neon/NextAuth dropped. **AI features (US4) are built LAST** — tasks marked **[AI phase]** are deferred until everything else is live.

- [ ] T101 CRITICAL — Create `README.md` at repo root with project description, feature overview, screenshots, tech stack rationale, setup instructions (reference `scripts/setup.sh`), architecture overview, and live demo link per Constitution I / T096 (missing)
- [ ] T102 CRITICAL — Write backend API integration tests `backend/tests/api/test_saved_jobs.py`, `test_tracker.py`, `test_ai.py`, `test_admin.py` covering save + duplicate prevention, stage CRUD + default-deletion block + move, resume upload + mocked generation + PDF, and admin stats/health + 403 for non-admin per Constitution V / T092 (partial)
- [ ] T103 CRITICAL — Add frontend test suites: Playwright e2e (`frontend/tests/e2e/auth.spec.ts`, `search.spec.ts`, `tracker.spec.ts`) and Vitest + RTL component tests for interactive components; wire both into `.github/workflows/ci.yml` per Constitution V / T095 (missing) **[depends on T105–T109]**
- [ ] T104 CRITICAL — **[AI phase]** Capture token usage from NVIDIA NIM responses in `backend/app/services/ai_service.py`, persist it on `GeneratedDocument`, and display token usage + estimated cost alongside model/time in `GeneratedDocViewer.tsx` per Constitution III (partial)
- [ ] T105 CRITICAL — Initialize the Next.js 15 project scaffold in `frontend/`: `package.json` + lockfile with all dependencies (next, react, tailwindcss, @tanstack/react-query, @supabase/supabase-js, @supabase/ssr, zod, @dnd-kit/core, @dnd-kit/sortable, recharts, lucide-react, date-fns, openapi-typescript), strict `tsconfig.json`, `next.config.ts`, Tailwind + PostCSS config, root `src/app/layout.tsx` + `globals.css`, ESLint/Prettier configs, and `vercel.json` per plan project structure / T003+T005+T008 (missing)
- [ ] T106 CRITICAL — Implement Supabase authentication: `frontend/src/lib/supabase.ts` (browser + server clients via `@supabase/ssr`), `frontend/src/app/(auth)/login/page.tsx` with email/password AND Google + GitHub OAuth sign-in, and `frontend/src/app/auth/callback/route.ts` per FR-013 / T019+T020+T022 (missing) **[depends on T105]**
- [ ] T107 CRITICAL — Create `frontend/src/providers.tsx` wrapping TanStack `QueryClientProvider` (+ a session context fed by Supabase auth state) and mount it in the root layout; replace the two `useSession()`/`next-auth/react` call sites in `admin/page.tsx` and `settings/page.tsx` with the Supabase equivalent per T024 (missing) **[depends on T105, T106]**
- [ ] T108 CRITICAL — Add shadcn/ui base components to `frontend/src/components/ui/` (button, card, badge, input, select, dropdown-menu, dialog, toast, skeleton, label, tabs, textarea — every component imported by existing pages/components) per T025 (missing) **[depends on T105]**
- [ ] T109 CRITICAL — Create `frontend/src/app/(dashboard)/layout.tsx` (server-side Supabase session check redirecting to `/login`) plus `frontend/src/components/layout/Navbar.tsx` and `Sidebar.tsx` per T021+T026 (missing) **[depends on T106]**
- [ ] T110 Rework `frontend/src/lib/api.ts` to attach the Supabase session access token as an `Authorization: Bearer` header instead of relying on `credentials: "include"` — the session cookie is not sent cross-origin from Vercel to Render per plan auth flow / T023 (contradicts) **[depends on T106]**
- [ ] T111 Implement permanent account deletion behind `DELETE /v1/users/me`: hard-delete (or schedule a purge of) all owned rows and stored resume/PDF files — the current handler only sets `deleted_at` while its docstring claims cascade deletion per FR-020 (partial)
- [ ] T112 Add `salary_max` and experience-level filter params to `GET /v1/jobs/search`, map them to Adzuna/JSearch request params in `backend/app/services/job_search.py`, and add matching controls to `SearchFilters.tsx` per FR-003 (partial)
- [ ] T113 Verify FR-013 is fully satisfied once T106 lands: email/password sign-up/sign-in (incl. password reset email) AND Google + GitHub OAuth all work end-to-end — the Supabase Auth decision (2026-07-14) resolves the earlier OAuth-only de-scope per FR-013 (contradicts → resolved by design)
- [ ] T114 Restore the generated-types pipeline: add a `prebuild` script running `openapi-typescript specs/001-job-search-mvp/contracts/openapi.yml -o src/types/api.d.ts` and reconcile the hand-written `frontend/src/types/api.ts` against it per Constitution VI / T019a (partial) **[depends on T105]**
- [ ] T115 Implement listing-expiry detection that sets `JobListing.is_expired` (e.g., flag listings absent from a source refresh or with a dead `apply_url`) and surface a "Listing Expired" badge on saved jobs per spec Edge Case "saved job posting removed from source" (partial)
- [ ] T116 Run the load test against staging (100 VUs, 5 min, targeting `GET /v1/jobs/search` and `POST /v1/ai/generate`; verify p95 under 3s / 15s) and document results in `docs/load-test-results.md` per SC-010 / T099b (missing)
- [ ] T117 Add a 500 error handler to `backend/app/main.py` alongside the existing 422 handler per T016 (partial)
- [ ] T118 Key API rate limits per authenticated user instead of per IP in `backend/app/main.py` and `backend/app/api/v1/ai.py` per T093 (partial)
- [ ] T119 Add an offline indicator that shows cached data with appropriate messaging for search/AI features per spec Edge Case "no internet connection" (missing)
- [ ] T120 **[AI phase]** Surface the 429 `Retry-After` value as an estimated-wait notification in the AI-apply UI per spec Edge Case "NVIDIA API rate limits exceeded" (partial)
- [ ] T121 Review `scripts/setup.sh` (not called for by spec/plan/tasks): document it in the README setup instructions or remove it per convergence review (unrequested)
- [ ] T122 Replace NextAuth JWE validation in `backend/app/middleware/auth.py` (`fastapi-nextauth-jwt`) with Supabase JWT verification (`python-jose` against `SUPABASE_JWT_SECRET`), resolving users by the token's email claim; update `backend/app/config.py`, `backend/pyproject.toml`, and `.env.example` (add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` → Supabase pooler; drop `AUTH_SECRET`/`NEXTAUTH_*`) per hosting decision 2026-07-14 (missing)
- [ ] T123 Create Render deployment config (`render.yaml`, reusing `backend/Dockerfile`) and a keep-alive ping — GitHub Actions cron (or UptimeRobot) hitting backend `/health` every ~10 min plus a daily Supabase query — so free tiers never sleep for visitors per hosting decision 2026-07-14 / SC-010 (missing)
- [ ] T124 **[AI phase]** Move uploaded resumes and generated PDFs from local disk to Supabase Storage (free hosts have ephemeral filesystems — files are lost on restart) per FR-008+FR-011 / hosting decision 2026-07-14 (partial)
- [ ] T125 Implement manual add-job per FR-004a (missing): backend — accept a user-supplied job (URL + title + company + optional location), create a `JobListing` with `source="manual"` (no external_id, skip dedup against API sources), and save it for the user in one call; frontend — "Add job manually" dialog on the Saved page (`frontend/src/app/(dashboard)/saved/page.tsx`) wired to it
- [ ] T126 Implement the "Did you apply?" confirmation per FR-006a (missing): when the user clicks a job's external apply link (`JobDetail.tsx` / tracker card), on return to the app show a one-click "Mark as Applied" prompt that moves the job to the Applied stage with today's date — never change status without confirmation
- [ ] T127 Set up the local development ("practice") environment (missing): two Supabase projects (dev + prod) documented, `.env.example` annotated with local vs production values, a seed script loading sample jobs/collections/stages for manual testing, and local run steps (backend + frontend) documented in README/quickstart; live deploys happen automatically from `main` (Vercel + Render GitHub integration, configured in T123)
- [ ] T128 **[post-launch, before AI]** Build browser extension v1 "job catcher" per FR-022a (missing): Manifest V3 extension with a content script that reads the job posting the user is viewing (LinkedIn/Indeed/Glassdoor selectors + generic fallback form), popup pre-filled for review, one-click authenticated save to the tracker via the API
- [ ] T129 Implement saved searches + "New matches" feed per FR-024 (missing): backend `SavedSearch` model + migration + CRUD, scheduled daily refresh job (APScheduler, Adzuna-first within the JSearch 200/month quota), feed endpoint returning jobs found since last visit; frontend "Save this search" button, saved-search management, and a "New matches" feed
- [ ] T130 **[AI phase]** Build browser extension v2 auto-fill + auto-track per FR-022+FR-022b+FR-023 (missing): profile-based form filling on external sites (fill, never submit), auto-save/update the filled job in the tracker and trigger the "Mark as Applied" confirmation (FR-006a)
