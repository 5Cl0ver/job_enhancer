# Job Enhancer — Feature Manifest

A living catalog of **every feature** in Job Enhancer: what it does, its current
status, how it works, and the files behind it. Kept honest — "planned" means not
built yet.

**Last updated:** 2026-07-29

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | **Built & working** end-to-end |
| 🟡 | **Partial** — built but not fully wired/activated/verified |
| 🔜 | **Planned** — designed/specced, not built |

## Architecture at a glance

```
Browser ──(Supabase session JWT as Bearer)──▶ FastAPI backend ──▶ Supabase Postgres
   │                                              │
 Vite + React SPA                                 ├─▶ Adzuna / JSearch / … (job data)
 (React Router, TanStack Query)                   └─▶ NVIDIA NIM (AI, final phase)
   │
 Supabase Auth (login/session, ECC/ES256 JWTs verified via JWKS)
```

- **Frontend:** Vite + React + TypeScript + React Router + TanStack Query + Tailwind + shadcn/ui. Dev: `npm run dev` (:5173).
- **Backend:** FastAPI + SQLAlchemy (async) + Alembic. Dev: `uvicorn app.main:app --reload` (:8000).
- **Data/Auth:** Supabase (Postgres + Auth + Storage). Hosting target: Vercel + Render + Supabase ($0/mo).

---

## 1. Authentication & Accounts

### 1.1 Sign in / Sign up — ✅ (GitHub OAuth 🟡)
- Email/password and "Continue with GitHub" via Supabase Auth. Session stored in the browser; access token attached as `Authorization: Bearer` on every API call.
- GitHub OAuth button exists but needs a one-time GitHub OAuth App + Supabase provider config to function (🟡).
- **Files:** `frontend/src/routes/Login.tsx`, `frontend/src/routes/AuthCallback.tsx`, `frontend/src/lib/supabase/client.ts`, `frontend/src/lib/api.ts`.

### 1.2 Route protection — ✅
- Dashboard routes are gated; unauthenticated users are redirected to `/login`. Signing out anywhere bounces immediately.
- **Files:** `frontend/src/routes/RequireAuth.tsx`, `frontend/src/routes/DashboardLayout.tsx`.

### 1.3 Backend token verification — ✅
- Verifies Supabase **asymmetric (ES256)** access tokens against the project JWKS (public keys). First login auto-creates the user; the `ADMIN_EMAIL` account is granted the `admin` role.
- **Files:** `backend/app/middleware/auth.py`.

### 1.4 Account self-service (export / delete) — ✅
- Export all your data as JSON; permanently delete your account (owned data cascades; shared job listings remain).
- **Files:** `frontend/src/routes/SettingsPage.tsx`, `backend/app/api/v1/users.py`.

---

## 2. Job Search & Discovery

### 2.1 Search UI (query, location, filters) — ✅
- Search box + filters (remote-only, job type, salary min/max, experience). Filters live in the URL (`?q=&remote_only=…`) so searches are shareable/bookmarkable. Paginated results grid.
- **Files:** `frontend/src/routes/SearchPage.tsx`, `frontend/src/components/jobs/{SearchBar,SearchFilters,SearchResults,JobCard}.tsx`, `frontend/src/hooks/useJobs.ts`.

### 2.2 Multi-source aggregation — 🟡
- Backend fetches Adzuna + JSearch in parallel, normalizes, dedupes, persists, returns a page. **Currently runs on seeded sample data** until real API keys are added; more sources + scheduled caching are planned (see [job-data-architecture.md](job-data-architecture.md)).
- **Files:** `backend/app/services/job_search.py`, `backend/app/api/v1/jobs.py`.

### 2.3 Auto-deduplication — ✅
- Two-phase: exact `content_hash` (SHA-256 of normalized title+company+location) + fuzzy match (rapidfuzz) so the same job from multiple boards appears **once**. Our signature quality feature.
- **Files:** `backend/app/services/dedup.py`.

### 2.4 Manual "add a job by link" — 🟡
- Paste a URL + title/company to track any job found elsewhere; tagged source `manual`.
- **Files:** `frontend/src/components/jobs/AddJobDialog.tsx`, backend saved-jobs path.

---

## 3. Saving & Organizing

### 3.1 Save / unsave jobs — ✅
- Save from search; saved jobs persist per user.
- **Files:** `frontend/src/components/jobs/{SaveButton,CollectionSidebar}.tsx`, `frontend/src/hooks/useSavedJobs.ts`, `backend/app/api/v1/saved_jobs.py`, `backend/app/services/saved_jobs.py`.

### 3.2 Collections (folders) — ✅
- Create/rename/delete named collections; a default collection is seeded per user.
- **Files:** `frontend/src/routes/SavedPage.tsx`, `backend/app/api/v1/collections.py`, `backend/app/services/collections.py`.

---

## 4. Application Tracking (Kanban)

### 4.1 Kanban board — ✅
- Drag jobs across pipeline stages; optimistic UI. 8 default stages seeded per user (Interested → Applied → … → Offer/Rejected); custom stages supported.
- **Files:** `frontend/src/routes/TrackerPage.tsx`, `frontend/src/components/tracker/{KanbanBoard,PipelineColumn,KanbanCard}.tsx`, `frontend/src/hooks/useTracker.ts`, `backend/app/api/v1/tracker.py`, `backend/app/services/tracker.py`.

### 4.2 Follow-up reminders — ✅
- Applications with no stage change for `follow_up_days` are flagged; a scheduled job marks them.
- **Files:** `backend/app/services/notifications.py`, scheduler in `backend/app/main.py`.

### 4.3 "Did you apply?" confirmation — 🟡
- On returning from an external apply link, a one-click "Mark as Applied" records the date (never auto-changes status).
- **Files:** `frontend/src/components/jobs/ApplyButton.tsx`.

---

## 5. Saved Searches & New-Matches Feed

### 5.1 Save a search — ✅
- Save current search criteria (FR-024).
- **Files:** `frontend/src/components/jobs/SaveSearchButton.tsx`, `backend/app/api/v1/saved_searches.py`, `backend/app/services/saved_searches.py`.

### 5.2 "New Matches" feed — ✅ (auto-refresh 🟡)
- A feed of new jobs matching saved searches. A daily scheduled job refreshes them (activates fully once live job sources are wired).
- **Files:** `frontend/src/routes/MatchesPage.tsx`, `frontend/src/hooks/useSavedSearches.ts`.

---

## 6. Analytics — ✅
- Personal stats: jobs saved, applications sent, response rate, interviews; applications-per-week chart (last 8 weeks).
- **Files:** `frontend/src/routes/AnalyticsPage.tsx`, `frontend/src/components/analytics/{StatCard,ActivityChart}.tsx`, `frontend/src/hooks/useAnalytics.ts`, `backend/app/api/v1/analytics.py`.

---

## 7. Admin Dashboard — ✅
- Owner-only (`admin` role). Platform stats (total/active/new users), daily-signup trend chart, live health of external services, paginated user table.
- **Files:** `frontend/src/routes/AdminPage.tsx`, `frontend/src/components/admin/{HealthPanel,StatsOverview,UserTable,SignupTrendChart}.tsx`, `frontend/src/hooks/useAdmin.ts`, `backend/app/api/v1/admin.py`, `backend/app/services/admin_service.py`.

---

## 8. AI Quick-Apply — 🟡 (final phase)
- Upload a base resume (PDF/DOCX); generate a tailored resume + cover letter for a saved job via NVIDIA NIM (Llama 3.3); edit inline; download PDF. AI transparency (model + generation time) is surfaced. **Backend + UI exist but not activated** (NVIDIA key is a placeholder; scoped as the last build phase).
- **Files:** `frontend/src/routes/AiApplyPage.tsx`, `frontend/src/components/ai/*`, `frontend/src/hooks/useAI.ts`, `backend/app/api/v1/ai.py`, `backend/app/services/{ai_service,resume_parser}.py`.

---

## 9. Browser Extension — 🟡 (v1, test-backed rebuild)
- **v1 "Job Catcher":** ✅ built (`extension/`, Chrome MV3, **Side Panel** architecture). Capture is a **pure, unit-tested** function — `extractJob(document, url)` — that tries **schema.org `JobPosting` JSON-LD** first (standardized across most boards), then **per-site selectors** (Indeed/LinkedIn detail pages), then a generic `og:title` fallback. Two entry points share that tested code: a single **Save button** injected on Indeed/LinkedIn job pages, and the side panel's **Capture this page** / **Pick manually**. A background service worker handles Supabase login + token refresh + saving via `POST /v1/saved-jobs/manual` (no backend changes).
- **Testing:** Vitest unit tests over saved HTML fixtures (no browser needed) + a Playwright MV3 integration test that loads the built extension in real Chromium and asserts capture → `chrome.storage`. `npm run check`. This is what makes the extension reliable instead of guess-and-check.
- **Build:** esbuild bundles `src/*.entry.js` → `dist/` (`npm run build`); load-unpacked (see extension/README.md).
- **v2 Auto-fill:** 🔜 fill application forms from your profile + generated docs; never auto-submits.
- **Status:** v1 rebuilt on the detail-page + JSON-LD pattern with a real test harness; v2 planned (spec.md US7, FR-022–023).

---

## 10. Job-Data Aggregation Engine — 🟡 → 🔜

The plan to get broad, real listings for many users on $0. Full design in
[job-data-architecture.md](job-data-architecture.md).

| Piece | Status |
|---|---|
| Pluggable source-adapter pattern (`services/sources/`) | ✅ |
| Remotive adapter (free, keyless remote jobs) | ✅ |
| Jobicy adapter (free, keyless, keyword-searchable remote) | ✅ |
| The Muse adapter (free, non-remote; feed/scheduled) | ✅ |
| RemoteOK adapter (free, keyless remote feed; scheduled) | ✅ |
| Adzuna adapter | 🟡 (coded; needs real key) |
| JSearch adapter (Google-for-Jobs) | 🟡 (coded; 200/mo — reserve for scheduled/deep search) |
| Additional free sources (Jooble, USAJobs) | 🔜 |
| Scheduled background ingestion into the pool (`ingest_curated_jobs`, every 6h) | ✅ |
| Cache-first search (DB-first; live fetch on "Refresh" or empty pool) | ✅ |
| Hacker News "Who's Hiring" source (unique) | 🔜 |
| Source-coverage transparency in UI | 🔜 |
| Listing freshness / expiry | 🟡 (`is_expired` + daily job exists) |

---

## 11. Platform / Ops

| Feature | Status | Notes |
|---|---|---|
| Rate limiting | ✅ | 60/min default; 5/min on AI generate (`slowapi`) |
| Scheduled background jobs | ✅ | APScheduler: follow-ups, saved-search refresh, expiry, account purge |
| Soft-delete + purge of deleted accounts | ✅ | `users.deleted_at` + daily purge job |
| CI (lint, tests, build) | ✅ | `.github/workflows/ci.yml` |
| Test suites | ✅ | Backend pytest (38); frontend Vitest + Playwright |
| Deployment (Vercel + Render + Supabase) | 🔜 | Configs present (`render.yaml`, `keep-alive.yml`); not deployed yet |

---

## Roadmap (build order)

1. ✅ Core product (search, save, track, analytics, admin, auth) + Vite/Supabase migration
2. 🔜 **Job-data engine**: wire Adzuna + free sources behind dedup → scheduled cache (see [job-data-architecture.md](job-data-architecture.md))
3. 🔜 Deploy live ($0) — prove the pipeline early
4. 🔜 AI quick-apply (resume + cover letter)
5. 🔜 Browser extension (v1 catcher → v2 auto-fill)
6. 🔜 Unique edges: HN "Who's Hiring" source, source-coverage transparency
