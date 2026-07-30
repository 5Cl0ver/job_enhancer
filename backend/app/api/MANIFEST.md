# API Manifest (`backend/app/api/`)

FastAPI routers. Assembled in `v1/router.py` and mounted in `app/main.py`.
Base path: **`/v1`**. All routes require auth (`CurrentUser`) unless noted.

| Module | Prefix | Key endpoints |
|---|---|---|
| `v1/jobs.py` | `/jobs` | `GET /jobs/?q=…` (search + dedupe), `GET /jobs/{id}` |
| `v1/saved_jobs.py` | `/saved-jobs` | list / create / `PATCH` / `DELETE` (filters: collection, stage, archived) |
| `v1/collections.py` | `/collections` | full CRUD; `DELETE` blocked for `is_default` |
| `v1/tracker.py` | `/pipeline-stages` | stage CRUD + `POST /move` (Kanban) |
| `v1/saved_searches.py` | `/saved-searches` | save/list/delete searches, new-matches feed, mark-seen (FR-024) |
| `v1/analytics.py` | `/analytics` | `GET /analytics/summary` (totals + 8-week activity) |
| `v1/ai.py` | `/ai` | `POST /ai/resumes` (upload), `GET /ai/resumes`, `POST /ai/generate` (5/min), `GET/PATCH /ai/documents/{id}`, `GET /ai/documents/{id}/pdf` |
| `v1/users.py` | `/users` | `GET/PATCH /users/me`, `GET /users/me/export`, `DELETE /users/me` |
| `v1/admin.py` | `/admin` | `GET /admin/{stats,health,users}` — requires `role=admin` |
| `v1/auth.py` | — | auth helpers/routes (see file) |
| `v1/router.py` | — | aggregates all routers under `/v1` |

## Auth pattern (`middleware/auth.py`)
- **`CurrentUser`** — verifies the Supabase **ES256** token via the project **JWKS**; lazy-creates the User on first login.
- **`AdminUser`** — `CurrentUser` + `role == "admin"` (else 403).

## Rate limits (slowapi)
- Default **60/min**; `POST /ai/generate` **5/min**.

**How this folder connects:** routers validate with `schemas/*`, call
`services/*` for logic, depend on `middleware/auth.py`.
