# Data Model: Job Search Assistant MVP

**Branch**: `001-job-search-mvp` | **Date**: 2026-05-29

Derived from spec.md Key Entities and clarification session answers.

---

## Entity Overview

```
User ─────────────┬──── SavedJob ────── JobListing
                  │         │
                  ├──── Collection ◄─── SavedJob
                  ├──── Resume
                  └──── GeneratedDocument ── SavedJob
                  │
                  └── (admin: role field on User)
```

---

## 1. User

Represents a registered account. Supports both OAuth and email/password sign-in.
Admin status is a role field, not a separate entity.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, default gen_random_uuid() | |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | |
| `name` | VARCHAR(255) | | Display name from OAuth |
| `image` | TEXT | | Avatar URL from OAuth provider |
| `role` | VARCHAR(20) | NOT NULL, DEFAULT 'user' | 'user' \| 'admin' |
| `email_verified` | TIMESTAMPTZ | | Set when email verified |
| `follow_up_days` | INTEGER | NOT NULL, DEFAULT 7 | Days before follow-up reminder |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `deleted_at` | TIMESTAMPTZ | | Soft delete for data retention grace period |

### Indexes
- `UNIQUE (email)`
- `INDEX (role)` — for admin queries

### Validation Rules
- `email` MUST match RFC 5321 format
- `role` MUST be one of: `user`, `admin`
- `follow_up_days` MUST be between 1 and 90

### State Transitions
- `active` → `deleted` (soft delete via `deleted_at`)
- Hard delete scheduled 30 days after soft delete (FR-020)

### NextAuth.js Compatibility
NextAuth v5 with JWT strategy (`session: { strategy: "jwt" }`) does not require
an Accounts/Sessions table — the session lives in the encrypted cookie. If
a NextAuth DB adapter is added later, the `Account` and `Session` tables follow
the Auth.js schema standard.

---

## 2. JobListing

A job opportunity aggregated from external sources. Shared across all users
(not per-user). Deduplication happens at insert time.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `external_id` | VARCHAR(255) | UNIQUE, NOT NULL | `"{source}:{source_id}"` |
| `source` | VARCHAR(50) | NOT NULL | `'adzuna'` \| `'jsearch'` |
| `title` | VARCHAR(500) | NOT NULL | |
| `company` | VARCHAR(255) | NOT NULL | |
| `location` | VARCHAR(255) | NOT NULL | |
| `is_remote` | BOOLEAN | NOT NULL, DEFAULT false | |
| `description` | TEXT | | Snippet or full text |
| `salary_min` | INTEGER | | Annual, in local currency |
| `salary_max` | INTEGER | | Annual, in local currency |
| `currency` | VARCHAR(10) | DEFAULT 'USD' | ISO 4217 |
| `job_type` | VARCHAR(50) | | `'full_time'` \| `'part_time'` \| `'contract'` |
| `apply_url` | TEXT | NOT NULL | Direct or redirect URL |
| `posted_at` | TIMESTAMPTZ | | From source API |
| `expires_at` | TIMESTAMPTZ | | NULL until detected as expired |
| `is_expired` | BOOLEAN | NOT NULL, DEFAULT false | Set when source removes listing |
| `content_hash` | VARCHAR(64) | UNIQUE, NOT NULL | SHA-256 of normalized company+title+location |
| `company_normalized` | VARCHAR(255) | NOT NULL | Lowercased, punctuation-stripped |
| `title_normalized` | VARCHAR(500) | NOT NULL | Lowercased, punctuation-stripped |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `refreshed_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last API sync |

### Indexes
- `UNIQUE (external_id)`
- `UNIQUE (content_hash)` — Phase 1 dedup
- `INDEX (company_normalized, title_normalized)` — Phase 2 fuzzy dedup candidate narrowing
- `INDEX (posted_at DESC)` — date-sorted search results
- `INDEX (is_expired)` — filter out expired listings

### Validation Rules
- `content_hash` auto-computed from `normalize(company) + "|" + normalize(title) + "|" + normalize(location)`
- `company_normalized` and `title_normalized` auto-computed at insert
- `salary_min <= salary_max` if both present
- `source` MUST be a known enum value

---

## 3. Collection

A user-created group for organizing saved jobs.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → User.id, NOT NULL | Cascade delete |
| `name` | VARCHAR(255) | NOT NULL | |
| `description` | TEXT | | Optional user note |
| `color` | VARCHAR(7) | | Hex color for UI label |
| `sort_order` | INTEGER | NOT NULL, DEFAULT 0 | User-defined ordering |
| `is_default` | BOOLEAN | NOT NULL, DEFAULT false | System default "Saved" collection |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### Indexes
- `INDEX (user_id)`
- `UNIQUE (user_id, name)` — no duplicate collection names per user

### Validation Rules
- `name` 1–100 characters
- `color` MUST be valid hex (`#RRGGBB`) if set
- `is_default` — only one default collection per user enforced at application layer

### Seed Data
Each new user gets a default "Saved" collection created automatically on first
save action.

---

## 4. SavedJob

Junction between User and JobListing, enriched with tracking state.
This is the core application-tracking entity.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → User.id, NOT NULL | Cascade delete |
| `job_listing_id` | UUID | FK → JobListing.id, NOT NULL | |
| `collection_id` | UUID | FK → Collection.id | NULL = in default collection |
| `pipeline_stage_id` | UUID | FK → PipelineStage.id | NULL = "Interested" |
| `notes` | TEXT | | User free-form notes |
| `applied_at` | TIMESTAMPTZ | | Set when moved to Applied stage |
| `last_stage_change` | TIMESTAMPTZ | DEFAULT now() | For follow-up reminder logic |
| `follow_up_sent_at` | TIMESTAMPTZ | | Last follow-up reminder sent |
| `is_archived` | BOOLEAN | NOT NULL, DEFAULT false | Soft archive |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### Indexes
- `UNIQUE (user_id, job_listing_id)` — a user can only save a job once
- `INDEX (user_id, pipeline_stage_id)` — Kanban board queries
- `INDEX (user_id, collection_id)` — collection view queries
- `INDEX (last_stage_change)` — follow-up reminder cron

### State Transitions (Pipeline)
Pipeline stage is stored in `pipeline_stage_id` (FK to PipelineStage table).
Moving between stages updates `last_stage_change`. When stage moves to "Applied",
`applied_at` is set (once, never overwritten).

---

## 5. PipelineStage

User-customizable pipeline stages (per-user). Default stages are seeded
per user on account creation.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → User.id, NOT NULL | Cascade delete |
| `name` | VARCHAR(100) | NOT NULL | |
| `sort_order` | INTEGER | NOT NULL | Display order on Kanban |
| `color` | VARCHAR(7) | | Hex color for Kanban column |
| `is_default` | BOOLEAN | NOT NULL, DEFAULT false | Cannot be deleted by user |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### Indexes
- `UNIQUE (user_id, name)` — no duplicate stage names per user
- `INDEX (user_id, sort_order)` — Kanban ordering

### Default Stages (seeded per user, in order)
1. Interested (sort_order=1)
2. Referral Sent (sort_order=2)
3. Applied (sort_order=3)
4. Phone Screen (sort_order=4)
5. Take-Home Assignment (sort_order=5)
6. Interview (sort_order=6)
7. Offer (sort_order=7)
8. Rejected (sort_order=8)

Default stages have `is_default=true` — they can be renamed or reordered
but not deleted (enforced at application layer).

---

## 6. Resume

A user's uploaded base resume document. Stored for AI processing.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → User.id, NOT NULL | Cascade delete |
| `filename` | VARCHAR(255) | NOT NULL | Original uploaded filename |
| `file_size` | INTEGER | NOT NULL | Bytes |
| `mime_type` | VARCHAR(100) | NOT NULL | `application/pdf` \| `application/vnd.openxmlformats...` |
| `storage_path` | TEXT | NOT NULL | Path in object storage (Railway volume or S3) |
| `parsed_text` | TEXT | | Extracted text for AI processing |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT true | Only one active resume per user |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### Indexes
- `INDEX (user_id, is_active)` — fetch active resume

### Validation Rules
- `mime_type` MUST be `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `file_size` MUST be <= 10MB (10,485,760 bytes)
- Only one `is_active=true` resume per user at a time (application-layer toggle)

---

## 7. GeneratedDocument

An AI-produced tailored resume or cover letter tied to a specific saved job.

### Fields

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → User.id, NOT NULL | Cascade delete |
| `saved_job_id` | UUID | FK → SavedJob.id, NOT NULL | Cascade delete |
| `resume_id` | UUID | FK → Resume.id | Source resume used |
| `document_type` | VARCHAR(50) | NOT NULL | `'resume'` \| `'cover_letter'` |
| `content` | TEXT | NOT NULL | AI-generated text content |
| `edited_content` | TEXT | | User-edited version |
| `pdf_path` | TEXT | | Path to rendered PDF (if downloaded) |
| `model_used` | VARCHAR(100) | | e.g., `meta/llama-3.3-70b-instruct` |
| `generation_ms` | INTEGER | | Latency tracking |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | Increments on regenerate |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

### Indexes
- `INDEX (saved_job_id, document_type)` — fetch docs for a specific saved job
- `INDEX (user_id)` — user's document history

### Validation Rules
- `document_type` MUST be `'resume'` or `'cover_letter'`
- `content` NOT empty after generation
- `version` increments by 1 on each regeneration (old versions not retained —
  `edited_content` stores the last user edit)

---

## Migration Order

Due to foreign key constraints, tables must be created in this order:

1. `users`
2. `job_listings`
3. `pipeline_stages` (depends on `users`)
4. `collections` (depends on `users`)
5. `saved_jobs` (depends on `users`, `job_listings`, `collections`,
   `pipeline_stages`)
6. `resumes` (depends on `users`)
7. `generated_documents` (depends on `users`, `saved_jobs`, `resumes`)

---

## Cascade Delete Rules

When a `User` is deleted (FR-020 account deletion):
- `PipelineStage` → deleted (CASCADE)
- `Collection` → deleted (CASCADE)
- `SavedJob` → deleted (CASCADE)
- `Resume` → deleted (CASCADE), storage files purged async
- `GeneratedDocument` → deleted (CASCADE), PDF files purged async
- `JobListing` → NOT deleted (shared resource; may be saved by other users)
