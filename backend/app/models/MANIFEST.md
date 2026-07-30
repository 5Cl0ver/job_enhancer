# Models Manifest (`backend/app/models/`)

SQLAlchemy 2.x ORM models. All inherit from `Base` (`__init__.py`), which also
imports every model so Alembic can discover them.

| File | Model | Purpose | Depends on |
|---|---|---|---|
| `__init__.py` | `Base` | Declarative base + model registry for Alembic | — |
| `user.py` | `User` | Accounts (Supabase Auth: email/password + OAuth). UUID PK, soft-delete via `deleted_at`, `role` (user/admin), `image`, `follow_up_days`. | — |
| `job_listing.py` | `JobListing` | **Shared** (not per-user) job pool. Deduped on `content_hash` + fuzzy (`company_normalized`, `title_normalized`). Indexes on `posted_at`, `is_expired`. | — |
| `collection.py` | `Collection` | User folders for saved jobs. `UNIQUE(user_id, name)`; `is_default` protected; `color`, `sort_order`. | `User` |
| `pipeline_stage.py` | `PipelineStage` | Kanban columns. `UNIQUE(user_id, name)`; `sort_order`; 8 defaults seeded per user; `is_default` blocks deletion. | `User` |
| `saved_job.py` | `SavedJob` | Join of User×JobListing + state (stage, notes, `applied_at`, follow-up, `is_archived`). `UNIQUE(user_id, job_listing_id)`. | `User`, `JobListing`, `Collection`, `PipelineStage` |
| `saved_search.py` | `SavedSearch` | Stored search criteria; drives the daily new-matches feed (FR-024). | `User` |
| `resume.py` | `Resume` | Uploaded resume; `extracted_text`; one `is_active` per user (≤10 MB). | `User` |
| `generated_document.py` | `GeneratedDocument` | AI resume/cover output; `model_used` + `generation_ms` (transparency); `edited_content`. | `User`, `JobListing`, `Resume`, `SavedJob` |

## Migrations (`alembic/versions/`)
1. `0001_initial_schema` — core tables
2. `0002_saved_searches` — saved-search table (FR-024)
3. `6d32186f6f5a_sync_schema_with_current_models` — aligns schema with the models above (added `users.image`, `sort_order`s, etc.)

Run with `alembic upgrade head`. **Note:** tests use SQLite (`create_all` from
models), so always verify migrations against real Postgres.

**How this folder connects:** models are the source of truth for the DB;
`schemas/*` serialize them; `services/*` query them.
