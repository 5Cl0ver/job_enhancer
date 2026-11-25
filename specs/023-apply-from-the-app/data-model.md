# Data model: Apply from the app

Migration `t8c9d0e1f2a4_apply_from_the_app`, after `s7b8c9d0e1f3`.

## `apply_runs`: new columns

| Column | Type | Notes |
|---|---|---|
| `messages` | JSON list, not null, default `[]` | `{id, by: "you"\|"claude", text (≤1000), at, read}`. Newest 200 kept. |
| `claude_at` | timestamptz, nullable | Last connector call for this run. |

## `apply_runs.help`: new keys

| Key | Notes |
|---|---|
| `choices` | Up to 4 strings, each 80 characters or fewer. |
| `reply` | The user's answer (≤1000), or null. |
| `peek_request` | The peek taken when help was asked. |

## `apply_runs.review`: new keys

| Key | Notes |
|---|---|
| `confirmed` | `{words, at}`, set when Job Catcher saw the confirmation. |

## `apply_requests`

- New kind `peek` (one screen, no scrolling; photos at `page_n = 0`).

## `apply_photos`

- `page_n = 0` holds "screen now" photos. Only the newest 5 per run are kept.

## `job_listings`

- title, company and location are HTML-unescaped on save. The migration fixes the stored rows.

## Status rules (no new statuses)

| Situation | Rule |
|---|---|
| "Claude's turn" | status in reading/writing/filling/submitting; or questions with `answers_done`; or needs_you with `help.done_at`; or review with an unread decision. |
| "Stopped" | Claude's turn, and `claude_at` (or `started_at`) is over 3 min ago. |
| "Ask if sent" | status submitting for over 2 min, or a submit was pressed with no confirmation. |
