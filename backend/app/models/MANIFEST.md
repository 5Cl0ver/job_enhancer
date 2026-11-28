# Models Manifest (`backend/app/models/`)

SQLAlchemy 2.x ORM models. All inherit from `Base` (`__init__.py`), which also
imports every model so Alembic can discover them.

| File | Model | Purpose | Depends on |
|---|---|---|---|
| `__init__.py` | `Base` | Declarative base + model registry for Alembic | — |
| `user.py` | `User` | Accounts (Supabase Auth: email/password + OAuth). UUID PK, soft-delete via `deleted_at`, `role` (user/admin), `image`, `follow_up_days`; `forgotten_answers` (spec 029: question keys whose answer the user deleted, never learned again from Claude). | — |
| `job_listing.py` | `JobListing` | **Shared** (not per-user) job pool. Deduped on `content_hash` + fuzzy (`company_normalized`, `title_normalized`). Indexes on `posted_at`, `is_expired`. | — |
| `collection.py` | `Collection` | User folders for saved jobs. `UNIQUE(user_id, name)`; `is_default` protected; `color`, `sort_order`. | `User` |
| `pipeline_stage.py` | `PipelineStage` | Kanban columns. `UNIQUE(user_id, name)`; `sort_order`; 8 defaults seeded per user; `is_default` blocks deletion. | `User` |
| `saved_job.py` | `SavedJob` | Join of User×JobListing + state (`origin`: scout / email / extension / claude / search / manual, null when unknown; `custom_title` / `custom_company` / `custom_location` / `custom_apply_url`: the user's own name for the job — or, with `apply_url_learned`, the company's application Job Catcher learned after an Apply on the board, spec 040, which a later Apply may replace; stage, notes, `applied_at`, follow-up, `is_archived`). `UNIQUE(user_id, job_listing_id)`. | `User`, `JobListing`, `Collection`, `PipelineStage` |
| `detected_event.py` | `DetectedEvent` | One email the inbox scan read and what it means for a saved job: pending / applied / auto_applied / needs_review / hidden / unsaved / contact / dismissed, plus (spec 027) `noted` (on the job, no move needed; `seen_at`) and `skipped` ("Looked at, not shown", `skip_reason`, kept 30 days). | `User`, `EmailAccount`, `SavedJob` |
| `usage.py` | `UsageCounter`, `AppSetting` | Fair use (spec 019 part C): uses per person, kind and Pacific day, plus the one shared JSearch month (`user_id` NULL; unique with NULLS NOT DISTINCT); owner-editable settings such as the `allowances` numbers. `User.last_active_at` is real use, touched every 15 minutes by auth. | `User` |
| `onboarding.py` | `UserOnboarding` | One row per account (spec 019 part B): Welcome step and finished/dismissed, profile reviewed, Getting started hidden, Claude connector last seen. Everyone from before was backfilled as done. | `User` |
| `saved_search.py` | `SavedSearch` | Stored search criteria; drives the daily new-matches feed (FR-024). | `User` |
| `resume.py` | `Resume` | Uploaded resume; `extracted_text`; one `is_active` per user (≤10 MB). | `User` |
| `scout.py` | `ScoutMission`, `ScoutRun`, `ScoutCapture`, `ScoutFinding`, `ScoutCompany`, `ScoutPass`, `ScoutTitle`, `ScoutInstructionVersion`, `ScoutRunEvent` | Claude Scout: saved searches (LinkedIn, Indeed, ZipRecruiter, Google Jobs or Local companies); runs (`criteria` snapshot, queued → running → done/stopped); the exact page copy the extension captured; every job a run reported (the dedupe memory, keyed by company/title and canonical URL); the local companies a search checked (by website domain: when, how often, what was there, never-check); the results rows Claude passed over because the title didn't fit a resume type (keys only, 30 days); the titles each "Anything I'd be good at" search tried, with runs and good fits; missions' `overrides` and findings' `search_title` / `closest_track_id`; each user's saved versions of what Claude is told; each run's log of connector calls (never the resume or instruction texts) | `User`, `ResumeTrack`, `SavedJob` |
| `resume_track.py` | `ResumeTrack` | Claude Scout resume type: target titles, key skills, `skip_rules`, `min_pay`, the resume to apply with. ≤8 per user, `UNIQUE(user_id, name)`; `saved_jobs.track_id` points here. | `User`, `Resume` |
| `generated_document.py` | `GeneratedDocument` | AI resume/cover output; `model_used` + `generation_ms` (transparency); `edited_content`. `document_type` `cover_letter` = a cover letter (spec 031); `saved_jobs.cover_letter_id` and `apply_runs.cover_letter_id` point here (SET NULL; migration `z4c5d6e7f8a0`). | `User`, `JobListing`, `Resume`, `SavedJob` |
| `skipped_site.py` | `SkippedSite` | Sites to skip (spec 024): one plain host per row ("learn4good.com", lowercase, no "www."); `UNIQUE(user_id, host)`, ≤100 per user (service); RLS on. | `User` |
| `apply.py` | `ApplyRun`, `ApplyRequest`, `ApplyPhoto`, `ProfileFact` (spec 022): an application Claude makes for one saved job (questions, pages, review, events as JSON), what it asked Job Catcher to do, Job Catcher's photos of each page, and the things the user told Claude. `resumes.is_master` / `resumes.document_id` mark the master résumé and résumés made for a job. Spec 025: `apply_runs.resume_picked` / `resume_check` (the user's look at the résumé), `users.review_resumes`. Spec 026: `apply_runs.live` (the boxes being filled now). Spec 030: `apply_runs.problems` (what Claude ran into, ≤20) Spec 033 (migration `b6c7d8e9f0a2`): `apply_runs.sheet` (every box by step), `fixes` (the owner's changes waiting for a checkpoint), `mode` (page / keep), `paused_step`, `live_changed_at`. |
| `bug_report.py` | `BugReport`, `BugReportEvent`, `BugReportLink`, `BugReportShot` | Bugs & ideas (spec 032, migration `a5b6c7d8e9f1`): one bug or idea per report (no user column), an append-only event log (seen, status, edit, note, merge, split, link, unlink; `actor` = owner / claude / app), "related to" pairs (`a_id < b_id`), screenshots as bytes (routes in part B). `seed_key` marks the 5 starting entries; `merged_into_id` hides a merged report; `fingerprint` merges repeats. RLS on. | `ApplyRun`, `SavedJob` |
| `custom_answer.py` | `CustomAnswer` | Autofill memory: one remembered answer per (user, normalized question key); usage counts; `source` = "claude" for an answer learned from an approved Apply with Claude run (spec 029, migration `y3c5e7a9b1d2`), null for the user's own. | `User` |

## Migrations (`alembic/versions/`)
1. `0001_initial_schema` — core tables
2. `0002_saved_searches` — saved-search table (FR-024)
3. `6d32186f6f5a_sync_schema_with_current_models` — aligns schema with the models above (added `users.image`, `sort_order`s, etc.)

Run with `alembic upgrade head`. **Note:** tests use SQLite (`create_all` from
models), so always verify migrations against real Postgres.

**How this folder connects:** models are the source of truth for the DB;
`schemas/*` serialize them; `services/*` query them.
