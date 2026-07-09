# Services Manifest

Business logic layer for Job Enhancer. Services are pure async functions — no FastAPI dependencies.

| File | Purpose | Key Functions |
|------|---------|---------------|
| `users.py` | User account lifecycle | `create_user()` — creates User + seeds Collection + seeds PipelineStages on first OAuth login; `soft_delete_user()` |
| `dedup.py` | Job listing deduplication | `normalize()` — lowercase + strip punctuation; `job_content_hash()` — SHA-256 of title+company+location; `is_duplicate()` — fuzzy match via rapidfuzz (title ≥88, company ≥85) |
| `job_search.py` | Multi-source job search | `aggregate_and_deduplicate()` — fetches Adzuna + JSearch in parallel, parses, deduplicates, upserts to DB, returns paginated results |
| `collections.py` | Collection CRUD | `create_default_collection()`, `list_collections()`, `create_collection()`, `update_collection()`, `delete_collection()` (blocks default) |
| `saved_jobs.py` | Saved job CRUD | `save_job()`, `list_saved_jobs()`, `update_saved_job()` (tracks `last_stage_change`), `delete_saved_job()` |
| `tracker.py` | Kanban pipeline management | `seed_default_stages()` (8 stages), stage CRUD, `move_job_to_stage()` (sets `applied_at` once on "Applied") |
| `resume_parser.py` | Resume text extraction | `parse_resume_pdf()` via pdfplumber; `parse_resume_docx()` via python-docx |
| `ai_service.py` | NVIDIA NIM AI generation | `generate_tailored_resume()`, `generate_cover_letter()` — both return `(content, model_used, generation_ms)`; handles 429 rate limits |
| `admin_service.py` | Platform monitoring | `get_platform_stats()` (user counts, daily signups); `check_service_health()` (pings DB, NVIDIA, Adzuna, JSearch) |
| `notifications.py` | Follow-up reminders | `send_follow_up_reminders()` — APScheduler hourly task; flags `follow_up_sent_at` on stale applications |

## Design Principles

- All DB operations use `async with db_session` — no synchronous SQLAlchemy
- Services `flush()` (not `commit()`) — routers own the transaction boundary
- Errors raised as `HTTPException` with appropriate status codes
- No circular imports: services never import from `api/`
