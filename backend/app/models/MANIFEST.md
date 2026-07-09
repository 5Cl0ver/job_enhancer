# Models Manifest

SQLAlchemy ORM models for Job Enhancer. All inherit from `Base` defined in `__init__.py`.

| File | Model | Purpose | Dependencies |
|------|-------|---------|--------------|
| `__init__.py` | `Base` | Declarative base; imports all models for Alembic discovery | — |
| `user.py` | `User` | User accounts. UUID PK, soft-delete via `deleted_at`, OAuth-only auth. Relationships: collections, pipeline_stages, saved_jobs, resumes, generated_documents | — |
| `job_listing.py` | `JobListing` | Shared (not per-user) job records. Deduplicated on `content_hash` (SHA-256) and fuzzy match via `company_normalized`+`title_normalized`. Indexes on `posted_at`, `is_expired`. | — |
| `collection.py` | `Collection` | User-created groups for saved jobs. UNIQUE(user_id, name). `is_default` protects the auto-created "Saved" collection. | `User` |
| `pipeline_stage.py` | `PipelineStage` | Kanban columns. UNIQUE(user_id, name). `DEFAULT_STAGES` list seeds 8 stages per new user. `is_default` blocks deletion. | `User` |
| `saved_job.py` | `SavedJob` | Join between User + JobListing with state (stage, notes, applied_at, follow-up tracking). UNIQUE(user_id, job_listing_id). | `User`, `JobListing`, `Collection`, `PipelineStage` |
| `resume.py` | `Resume` | Uploaded resume files. Parsed text stored in `extracted_text`. `is_active` flag — only one active resume per user. Max 10 MB. | `User` |
| `generated_document.py` | `GeneratedDocument` | AI-generated resumes and cover letters. Tracks `model_used` and `generation_ms` for transparency. `edited_content` holds user edits. | `User`, `JobListing`, `Resume`, `SavedJob` |

## Migration Order

1. `users`
2. `job_listings`
3. `collections`
4. `pipeline_stages`
5. `saved_jobs`
6. `resumes`
7. `generated_documents`

All managed by a single Alembic migration: `alembic/versions/0001_initial_schema.py`.
