# Architecture — How It All Fits Together (and Why)

The **mental-model layer**. This explains the *flows*, *connections*, and *design
decisions* — the things that are hard to reconstruct from any single file. It
stays at concept/flow altitude on purpose (see the note at the bottom on keeping
docs honest).

- For **what** the app does → [FEATURES.md](FEATURES.md)
- For **what's in a folder** → that folder's `MANIFEST.md`
- For the **exact details** → the code + tests (always the source of truth)

---

## 1. The 30-second picture

A **single-page React app** (Vite) talks over HTTPS to a **FastAPI backend**,
which owns a **Supabase Postgres** database and reaches out to external **job
sources** (and, in the final phase, an AI model). Login is handled by **Supabase
Auth**.

```
┌──────────────────────────┐   HTTPS / JSON   ┌──────────────────────────┐
│  React SPA (Vite)        │ ───────────────► │  FastAPI (Python)        │
│  React Router · TanStack │ ◄─────────────── │  SQLAlchemy 2 (async)    │
│  Query · Tailwind/shadcn │   Bearer token   │  Alembic migrations      │
└──────────┬───────────────┘                  └───────────┬──────────────┘
           │ login/session                                │ asyncpg
           ▼                                              ▼
   ┌────────────────┐                          ┌────────────────────────┐
   │ Supabase Auth  │                          │ Supabase Postgres      │
   │ (ES256 JWTs)   │                          │ (shared job pool, etc.)│
   └────────────────┘                          └───────────┬────────────┘
                                                           │
                        ┌──────────────────────────────────┼─────────────┐
                        ▼                                   ▼             ▼
                  Adzuna / JSearch / …            NVIDIA NIM (AI,     (more job
                  (pluggable job sources)          final phase)       sources…)
```

**Deployment target ($0/mo):** SPA on **Vercel** (static, always-on) · FastAPI on
**Render** (Docker, free) · **Supabase** free tier. Not deployed yet.

---

## 2. Request lifecycle — one search, end to end

The single most useful thing to understand. When you search "engineer":

```
1. You type "engineer" → React Router puts it in the URL: /search?q=engineer
2. SearchPage reads the URL; the useJobSearch hook (TanStack Query) fires
3. lib/api.ts sends:  GET /v1/jobs?q=engineer
                      Authorization: Bearer <your Supabase access token>
4. FastAPI middleware/auth.py verifies that token against Supabase's public
   keys (JWKS) → resolves (or creates) your User
5. jobs.py route → services/job_search.aggregate_and_deduplicate()
6. get_sources() → each source adapter .fetch() runs in parallel (Adzuna, …)
7. results are parsed → deduplicated → upserted into the shared job_listings pool
8. the DB is queried with your filters → paginated
9. JSON comes back → TanStack Query caches it → JobCards render
```

Every feature follows this same spine: **URL/UI → hook → api client → FastAPI
route → service → database → back**.

---

## 3. Auth flow (Supabase → FastAPI)

Concept-level (stays true even as libraries change):

```
Browser:
  1. User signs in (email/password or GitHub) via Supabase Auth
  2. Supabase issues a signed access token; the browser stores the session
  3. The React app attaches it as `Authorization: Bearer <token>` on every API call

FastAPI:
  4. middleware/auth.py fetches Supabase's PUBLIC keys (JWKS) and verifies the
     token's signature — no shared secret needed (asymmetric, ES256)
  5. reads the user's email from the verified token
  6. looks up the User (creates on first login; admin if email == ADMIN_EMAIL)
  7. hands `CurrentUser` to the route
```

**Why it's built this way:** Supabase signs tokens with a private key and
publishes the matching public key. The backend only needs the public key to
*verify* — the private key never leaves Supabase. This is the modern, more secure
pattern (asymmetric / JWKS) and needs no shared secret to leak. The frontend/
backend live on different hosts, so we pass the token as a **Bearer header**, not
a cookie.

---

## 4. Frontend data flow

The React app has a strict, one-directional shape (see `src/routes/`,
`src/hooks/`, `src/lib/` MANIFESTs):

```
routes/*  (a page/screen)
   │  renders
   ▼
components/*  (UI: cards, forms, board)
   │  calls
   ▼
hooks/*  (TanStack Query — caching, loading/error, mutations)
   │  fetches via
   ▼
lib/api.ts  (adds the Supabase Bearer token, throws on errors)
   │  HTTP
   ▼
FastAPI /v1
```

**Why:** pages never fetch directly; all server data goes through hooks →
`lib/api.ts`. One choke point for auth headers, error handling, and caching.

---

## 5. Job data: pluggable sources + dedup

**Sources are adapters** (`app/services/sources/`). Each implements `fetch`
(call its API) + `parse` (normalize to our shape). A registry lists them; the
search engine loops over `get_sources()`. **Adding a board = one new adapter
file** — the core never changes. *(Design pattern: Adapter.)*

**Deduplication** — the signature quality feature — merges the same job seen on
multiple boards into **one** row:

```
sources → parsed listings
   ↓
Phase 1 (exact):  content_hash = SHA-256(title|company|location normalized)
   → identical postings collapse via the DB unique constraint
   ↓
Phase 2 (fuzzy):  rapidfuzz — title ≥88 AND company ≥85 similarity → treat as dup
   ↓
new listings inserted into the SHARED job_listings pool (not per-user)
```

**Why a shared pool?** One deduped library of jobs serves everyone; a `saved_jobs`
row just links a user to a listing. This is also what lets us move fetching into a
scheduled background job later — see [job-data-architecture.md](job-data-architecture.md).

---

## 6. AI pipeline (final phase)

```
Upload resume (PDF/DOCX) → pdfplumber / python-docx → plain text (resumes.extracted_text)
   ↓
"Generate" for a saved job → ai_service.py → NVIDIA NIM (Llama 3.3)
   (system prompt + resume text + job description)
   ↓ response + model_used + generation_ms  → generated_documents
Edit inline (saved) · Download PDF (weasyprint HTML→PDF)
```

**Why store `model_used` + `generation_ms`:** AI transparency — users see which
model produced their doc and how long it took (a deliberate trust feature).

---

## 7. Background jobs (APScheduler, in `app/main.py`)

Run on a schedule inside the FastAPI process:

| Job | Cadence | Does |
|---|---|---|
| follow-up reminders | hourly | flags applications with no movement |
| saved-search refresh | daily | powers the "New Matches" feed |
| listing expiry | daily | marks stale listings expired (kept for tracking) |
| deleted-account purge | daily | hard-deletes soft-deleted accounts |

---

## 8. Key design decisions (the "why", in one place)

- **Adapter pattern for sources** → add boards without touching the engine.
- **Shared, deduped `job_listings` pool** → one library serves all users; enables scheduled ingestion.
- **App-layer auth (not Supabase RLS)** → FastAPI verifies the token and filters by `user_id`; the DB is reached only through the backend.
- **Asymmetric JWT (JWKS)** → verify with a public key, no shared secret.
- **Bearer token, not cookies** → frontend and backend are on different hosts.
- **TanStack Query as the only data layer** → caching + one place for auth/errors.

---

## Keeping this doc honest

This file describes **flows, connections, and decisions** — deliberately *not*
implementation details (no function signatures, no library-specific internals).
That's what keeps it from rotting: concepts stay true even when the code beneath
them changes. If you find yourself copying code into prose here, stop — link to
the code instead. **Update this doc only when a *flow* or *decision* changes**,
not when a line of code does.
