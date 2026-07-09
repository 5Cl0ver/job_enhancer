# API Manifest

FastAPI routers for Job Enhancer. All routes require authentication (via `CurrentUser` dependency) unless noted.

Base path: `/api/v1/`

| Module | Prefix | Tags | Key Endpoints |
|--------|--------|------|---------------|
| `v1/jobs.py` | `/jobs` | Jobs | `GET /jobs/?q=...` (search + deduplicate), `GET /jobs/{id}` |
| `v1/saved_jobs.py` | `/saved-jobs` | SavedJobs | `GET /saved-jobs/`, `POST /saved-jobs/`, `PATCH /saved-jobs/{id}`, `DELETE /saved-jobs/{id}` |
| `v1/collections.py` | `/collections` | Collections | Full CRUD; `DELETE` blocked for `is_default=true` collections |
| `v1/tracker.py` | `/pipeline-stages` | Tracker | Stage CRUD + `POST /move` to move jobs between Kanban columns |
| `v1/ai.py` | `/ai` | AI | `POST /ai/resumes` (upload), `GET /ai/resumes`, `POST /ai/generate` (5 req/min limit), `GET /ai/documents/{id}`, `PATCH /ai/documents/{id}`, `GET /ai/documents/{id}/pdf` |
| `v1/users.py` | `/users` | Users | `GET/PATCH /users/me`, `GET /users/me/export` (JSON download), `DELETE /users/me` |
| `v1/analytics.py` | `/analytics` | Analytics | `GET /analytics/summary` (totals + 8-week activity) |
| `v1/admin.py` | `/admin` | Admin | `GET /admin/stats`, `GET /admin/health`, `GET /admin/users` — requires `role=admin` |

## Auth Pattern

- `CurrentUser`: Resolves JWT from `fastapi-nextauth-jwt`, lazy-creates User on first login
- `AdminUser`: Wraps `CurrentUser` + checks `user.role == "admin"`, raises HTTP 403

## Rate Limits (slowapi)

- Default: 60 req/min per IP
- `POST /ai/generate`: 5 req/min per IP
