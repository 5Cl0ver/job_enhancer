# Data model: Every email about a job, kept and organized

The migration `x2a3b4c5d6e8_email_noted` comes after `w1f2a3b4c5d7`. It is additive.

## `detected_events` (existing table)

| Change | Type | Meaning |
|---|---|---|
| `seen_at` | timestamptz, null | When the user saw a noted email (opened its job). Null on a noted row = "New" |
| `skip_reason` | str(30), null | On a `skipped` row: `job_alert`, `no_saved_job` or `unclear` |

**New status values** (no schema change):

| Status | Meaning | Card |
|---|---|---|
| `noted` | Clearly about a saved job; no move needed (already at or past the stage, or a reminder). Always shown on the job | Never moved |
| `skipped` | Job-looking, but not put on a job (see `skip_reason`). Listed under "Looked at, not shown" for 30 days | Never moved |

**Rules:**
- `noted` and `skipped` rows count as known: they're never re-read or repeated, the same as other rows (`known_keys`, `_Seen`).
- `skipped` rows older than 30 days, or beyond the newest 500 per account, are deleted daily.
- "This is about my job" on a `skipped` row sets `saved_job_id`, status `noted`, and `match_evidence = user_link`, using the existing link code.
- Pending, review and auto-move logic never reads `noted` or `skipped` rows.

## Sections (app only, derived)

| Section | Event types |
|---|---|
| Interviews & next steps | interview, assessment |
| Decisions | offer, rejected |
| Your application | applied |
| Messages from people | recruiter, contact rows |
| Other | unsure and anything else on the job |
