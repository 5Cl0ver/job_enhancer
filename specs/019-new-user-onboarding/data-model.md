# Data model: 019 New-user onboarding

One Alembic migration adds the tables and the column below. Every new user-owned table has a foreign key to `users.id` with `ON DELETE CASCADE`, so deleting the account deletes it. Every table has RLS enabled with no policies, matching the existing tables (the API uses the service connection). Exports include the user-owned rows.

## user_onboarding (new, one row per user)

| Field | Type | Notes |
|---|---|---|
| user_id | uuid PK, FK users.id | |
| welcome_step | smallint, default 0 | 0 = not started; 1 = résumé; 2 = Job Catcher; 3 = extras; 4 = done |
| welcome_done_at | timestamptz null | Set on finish **or** dismiss. Null means show the Welcome on next load. |
| profile_reviewed_at | timestamptz null | Set when the person saves or confirms the profile on the review screen |
| checklist_hidden | bool, default false | "I'm all set". Settings can turn it back on. |
| claude_seen_at | timestamptz null | Set by the MCP server on any authenticated tool call (throttled to once an hour) |
| created_at / updated_at | timestamptz | |

**Migration backfill**: insert a row for every existing user with `welcome_done_at = now()`, `welcome_step = 4`. Existing users are never forced through the Welcome (FR-006).

**Created**: lazily, by `GET /v1/onboarding` (upsert) for users who sign up after the migration.

**Derived checklist ticks** (computed by `GET /v1/onboarding`, never stored):

| Item | Done when | Required |
|---|---|---|
| resume | the user has ≥1 résumé | yes |
| profile | `profile_reviewed_at` set, **or** the user pre-dates the feature and has a non-empty application profile (name and email) | yes |
| job_catcher | an `extension_installs` row exists | yes |
| first_job | ≥1 saved job | yes |
| email | an email account is connected | optional |
| claude | `claude_seen_at` set | optional |

## extension_installs (new)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users.id | |
| install_id | varchar(64) | A random id that Job Catcher creates once and keeps in `chrome.storage.local` |
| version | varchar(32) | Job Catcher's manifest version |
| browser | varchar(64) null | Coarse, e.g. "Chrome 142" or "Edge 142", from the panel's userAgentData. Never the full UA. |
| first_seen_at / last_seen_at | timestamptz | |

Unique `(user_id, install_id)`. Upserted by `POST /v1/extension/hello`. The admin view and the "update available" note use the newest `last_seen_at`.

## extension_tokens (new): Job Catcher passes

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users.id, cascade | |
| token_hash | varchar(64), unique | sha256 of the `jcx_…` pass. The pass itself is never stored. |
| install_id / browser | varchar(64) null | Filled by the first hello |
| created_at / last_used_at / revoked_at | timestamptz | `last_used_at` is touched at most every 15 minutes |

**Rules**:
- A pass is refused when revoked, unused for 90 days, older than 365 days, or when its account is deleted.
- At most 10 live passes per account; the oldest are revoked.

## extension_connect_requests (new, short-lived)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | varchar(8), unique | Shown to the person. Unambiguous letters and digits (no 0/O/1/I). |
| poll_token_hash | varchar(64), unique | sha256 of the panel's poll token. The raw token is never stored. |
| proof_hash | varchar(64) | sha256 of the starting Job Catcher's proof. Approval must present the proof. |
| user_id | uuid null FK users.id | Set on approve |
| status | varchar(16) | `pending` → `approved` → `used`; or `cancelled`; or `expired` (by time) |
| expires_at | timestamptz | created + 5 minutes |
| created_at | timestamptz | |

**Rules**:
- Approve only while `pending` and not expired.
- Poll hands out the sign-in **once** (`approved` → `used`).
- Rows older than a day are deleted by the existing purge job.

## usage_counters (new)

| Field | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| user_id | uuid null FK users.id | NULL only for the shared `jsearch_month` |
| kind | varchar(32) | `ai_document`, `ai_read`, `ai_autofill`, `live_search`, `jsearch_month` |
| period | varchar(10) | `YYYY-MM-DD` (US-Pacific day) for daily kinds; `YYYY-MM` for `jsearch_month` |
| count | int, default 0 | |

**Constraint**: unique `(user_id, kind, period)`, with `NULLS NOT DISTINCT` (Postgres 15+; Supabase is 15+) so the shared row is unique.

**Writes**: upsert-increment (spend) and conditional decrement (refund, never below 0).

**Cleanup**: daily rows older than 400 days are purged; the analytics history is kept for the year.

## app_settings (new, owner-editable)

| Field | Type | Notes |
|---|---|---|
| key | varchar(64) PK | e.g. `allowances` |
| value | jsonb | |
| updated_at | timestamptz | |

`allowances` value:
- `{ai_document: 10, ai_read: 5, ai_autofill: 100, live_search: 5, jsearch_month_cap: 200, jsearch_owner_reserve: 40}`.
- Missing keys fall back to code defaults.
- **Validation**: integers between 0 and 10000, and reserve ≤ cap.

## users (changed)

- `last_active_at timestamptz null`. It is touched in auth when older than 15 minutes, and the migration backfills it from `updated_at`.

## Export and delete

- `GET /v1/users/me/export` adds `onboarding`, `extension_installs` (version, browser, dates) and `usage` (the last 90 days).
- Account purge cascades to all of the above.
