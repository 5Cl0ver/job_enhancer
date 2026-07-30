# Services Manifest (`backend/app/services/`)

Business-logic layer — async functions, no FastAPI objects. Routers own the
transaction boundary (services `flush`, routers `commit`).

| File | Purpose | Key functions |
|---|---|---|
| `users.py` | User lifecycle | `create_user()` (seeds default collection + 8 pipeline stages; admin if email==ADMIN_EMAIL), `soft_delete_user()`, `purge_deleted_users()` (scheduled) |
| `dedup.py` | Listing dedup | `normalize()`, `job_content_hash()` (SHA-256), `is_duplicate()` (rapidfuzz: title ≥88, company ≥85) |
| `job_search.py` | Multi-source search | `aggregate_and_deduplicate()` — fetch Adzuna + JSearch in parallel, parse, dedupe, upsert, paginate; `mark_expired_listings()` (scheduled). **Being refactored to a pluggable adapter + cache model — see [docs/job-data-architecture.md](../../../docs/job-data-architecture.md)** |
| `collections.py` | Collection CRUD | create/list/update/delete (blocks default) |
| `saved_jobs.py` | Saved-job CRUD | `save_job()`, `list_saved_jobs()`, `update_saved_job()` (tracks `last_stage_change`), `delete_saved_job()` |
| `saved_searches.py` | Saved searches + matches | create/list/delete, `refresh_saved_searches()` (scheduled), new-matches feed (FR-024) |
| `tracker.py` | Kanban stages | `seed_default_stages()`, stage CRUD, `move_job_to_stage()` (sets `applied_at` once on "Applied") |
| `notifications.py` | Reminders | `send_follow_up_reminders()` (scheduled hourly) |
| `resume_parser.py` | Resume text | `parse_resume_pdf()` (pdfplumber), `parse_resume_docx()` (python-docx) |
| `ai_service.py` | NVIDIA NIM | `generate_tailored_resume()`, `generate_cover_letter()` → `(content, model_used, generation_ms)`; handles 429 |
| `admin_service.py` | Monitoring | `get_platform_stats()`, `check_service_health()` (pings DB/NVIDIA/Adzuna/JSearch) |

**Scheduled jobs** (registered in `app/main.py` via APScheduler): follow-up
reminders (hourly), saved-search refresh, listing expiry, deleted-account purge (daily).

**How this folder connects:** called by `api/v1/*`; operates on `models/*`;
never imports from `api/` (no circular deps).
