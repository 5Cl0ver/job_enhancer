# Services Manifest (`backend/app/services/`)

Business-logic layer — async functions, no FastAPI objects. Routers own the
transaction boundary (services `flush`, routers `commit`).

| File | Purpose | Key functions |
|---|---|---|
| `users.py` | User lifecycle | `create_user()` (seeds default collection + 8 pipeline stages; admin if email==ADMIN_EMAIL), `soft_delete_user()`, `purge_deleted_users()` (scheduled) |
| `dedup.py` | Listing dedup | `normalize()`, `job_content_hash()` (SHA-256), `is_duplicate()` (rapidfuzz: title ≥88, company ≥85) |
| `job_search.py` | Multi-source search | `aggregate_and_deduplicate()` — fetch Adzuna + JSearch in parallel, parse, dedupe, upsert, paginate; `mark_expired_listings()` (scheduled). **Being refactored to a pluggable adapter + cache model — see [docs/job-data-architecture.md](../../../docs/job-data-architecture.md)** |
| `collections.py` | Collection CRUD | create/list/update/delete (blocks default) |
| `scout_runs.py` | Claude Scout searches and runs | missions CRUD, `queue_run`, `runs_out`, `record_capture` (extension); connector side: `brief`, `check_jobs`, `report_job` (a good fit becomes a pick that waits for the user, or is saved at once when the search says "without asking"; always from the captured page copy, never Claude's text), `missions_out`, `finish_run`. Replies never grow with the tracker (spec research R8) |
| `scout_review.py` | Claude Scout's review step: Claude proposes, the user decides | `resolve_folder` / `peek_folder` (which collection: chosen on the save, on the search, or named after the resume type), `save_finding_job` (from the page copy only), `confirm_run` (save what was ticked; unticked picks become "skipped"), `save_one` (from History), `count_to_review` |
| `scout_dedupe.py` | Claude Scout keys (pure) | `company_key`, `title_key`, `url_key` (one key per posting across tracking params/side panes), `posting_problem` (search/home pages), `posting_link` |
| `scout_tracks.py` | Claude Scout resume types | list/create/update/delete (≤8, unique names, own resumes only; delete untags jobs), `to_out()` adds file name + job count |
| `saved_jobs.py` | Saved-job CRUD | `save_job()` / `save_manual_job()` (both record `origin`: how the job got here), `scout_fits()`, `rename_listing()` (this user's job only: a shared or feed listing is copied first, documents follow; a duplicate name is a 409), `doubtful_names()`, `list_saved_jobs()`, `update_saved_job()` (tracks `last_stage_change`), `delete_saved_job()` |
| `job_source.py` | Where a saved job came from | `job_source()`: its collection, plus the Claude Scout search (fit, why, gaps, run) or the email it was made from. Read-only, user-scoped |
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
