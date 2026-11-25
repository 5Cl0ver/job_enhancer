# Contracts: Every email about a job, kept and organized

All routes are owner-only (the signed-in user's own inbox and jobs).

| Route | Change |
|---|---|
| `GET /v1/email/job-emails?job_listing_id=` | Also returns `noted` rows. Each row adds `seen` (bool) and `effect` (`moved` / `noted` / `waiting`) |
| `POST /v1/email/job-emails/seen {job_listing_id}` | New. Marks that job's noted emails seen. 204 |
| `GET /v1/email/job-emails/latest` | Each row adds `unseen` (count of new noted emails), for the board's dot |
| `GET /v1/email/new` | New. Unseen noted emails from the last 14 days, newest first, each with its job (title, company, listing id) |
| `GET /v1/email/looked-at` | New. Skipped rows from the last 30 days: subject, sender, date, `skip_reason`, open-mail link |
| `POST /v1/email/events/{id}/link` | Existing (013). On a `skipped` row it now makes it `noted` on the chosen job |
| `POST /v1/email/recheck {days: 1..45}` | New. Re-reads the window with the new rules; never moves cards; never saves cursors. Returns `{found, noted, waiting, looked_at}`. 409 while a scan runs; 429 under backoff (as for `/scan`) |
| `POST /v1/email/scan` | Unchanged in shape. `skipped` counts no longer include `already_at_or_past_stage` (those are now noted); a `noted` count is added |

## App UI

| Where | What |
|---|---|
| Job page and pop-up | **Emails about this job** in sections (Interviews & next steps, Decisions, Your application, Messages from people, Other), a "Latest: …" line, a New badge, 3 per section then "Show N more" |
| Email updates | **New emails on your jobs** (open job); **Looked at, not shown** (reason, This is about my job, Open email); **Re-check the last 30 days** |
| Board card | A small dot when its job has a new email |
