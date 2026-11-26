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
| `v1/email.py` (job emails) | `/email` | `POST/GET /email/recheck` (re-check N days in the background), `POST /email/job-emails/seen`, `GET /email/job-emails/unseen`, `GET /email/new`, `GET /email/looked-at`, `POST /email/events/{id}/keep` (spec 027);  `GET /email/job-emails?job_listing_id=` (one job's emails) · `GET /email/job-emails/latest` (for every saved job with emails, the one behind its stage: one request for the whole board). Each event carries `mail_link` (the message itself in webmail when it can be named) and `mail_search_link` |
| `v1/ai.py` (resumes) | `/ai` | `GET /ai/resumes/{id}/file` (view one of your resumes in the browser) · `GET /ai/resumes/{id}/skills` (skills the resume names, as it writes them, to pre-fill a resume type; word list, no AI) |
| `v1/attention.py` | `/attention` | `GET /attention` (counts for the nav badges: email updates to review; to-do counts reserved) |
| `v1/scout.py` | `/scout` | Claude Scout: `GET/POST /scout/tracks`, `PATCH/DELETE /scout/tracks/{id}`; `GET/POST /scout/missions`, `PATCH/DELETE /scout/missions/{id}`, `POST /scout/missions/{id}/runs` (Start); `GET /scout/runs`, `GET /scout/runs/active` (extension), `GET /scout/runs/{id}`, `POST /scout/runs/{id}/stop`; `POST /scout/captures` (extension page copy) |
| `v1/ai.py` | `/ai` | `POST /ai/resumes` (upload; `?make_active=false` keeps the main resume), `GET /ai/resumes`, `POST /ai/generate` (5/min), `GET /ai/documents` (list, optional `?job_listing_id=`), `GET/PATCH /ai/documents/{id}`, `GET /ai/documents/{id}/pdf` |
| `v1/users.py` | `/users` | `GET/PATCH /users/me`, `GET /users/me/export` (includes the sites to skip), `DELETE /users/me` |
| `v1/skipped_sites.py` | `/skipped-sites` | Sites to skip (spec 024), owner only: `GET` (newest first), `POST {site, confirm?}` (201 added, 200 already there, 400 not a site / over 100, 409 `needs_confirm` for a site Scout searches), `DELETE /{id}`, `GET /suggestions` |
| `v1/admin.py` | `/admin` | `GET /admin/{stats,health,users}`, `GET /admin/apply-problems` (bug reports: problems Claude ran into, everyone's) and `PATCH /admin/apply-problems/{run_id}/{id}` (open / fixed / ignored), spec 030 — requires `role=admin` |
| `v1/auth.py` | — | auth helpers/routes (see file) |
| `v1/router.py` | — | aggregates all routers under `/v1` |
| `v1/apply.py` | `/v1/apply/*` (the app: start (with a picked résumé, spec 025), open, runs for a job, one run, answers, help-done, resume-decision, decision, sent, stop, photos; Job Catcher with its pass: active, claim, photo, result, event, live (spec 026); live-fix (change a box while Claude fills, spec 030)) and `/v1/profile-facts` (list, edit, delete) — spec 022 |

## Auth pattern (`middleware/auth.py`)
- **`CurrentUser`** — verifies the Supabase **ES256** token via the project **JWKS**; lazy-creates the User on first login.
- **`AdminUser`** — `CurrentUser` + `role == "admin"` (else 403).

## Rate limits (slowapi)
- Default **60/min**; `POST /ai/generate` **5/min**.

**How this folder connects:** routers validate with `schemas/*`, call
`services/*` for logic, depend on `middleware/auth.py`.
