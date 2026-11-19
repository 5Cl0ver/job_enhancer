# Data model: UX overhaul

One new table, a few columns, one backfill. Migration revision follows
`a8b9c0d1e2f4` (Scout runs). RLS is enabled on the new table like every other.

## job_tasks (new) — a thing the user has to do for a saved job

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK `users` CASCADE, indexed | owner |
| `saved_job_id` | UUID FK `saved_jobs` CASCADE, indexed | the job it belongs to |
| `kind` | String(20) | `interview` · `assessment` · `offer` · `follow_up` · `other` |
| `title` | String(200) | e.g. "Assessment to do"; editable |
| `due_at` | timestamptz, null | set by the user; never guessed from email text |
| `source_event_id` | UUID FK `detected_events` SET NULL, null | the email that created it |
| `done_at` | timestamptz, null | null = open |
| `created_at` | timestamptz | |

- Unique `(source_event_id)` where not null: one task per email, however many
  times that email is re-scanned or re-applied.
- Index `(user_id, done_at)` for "my open tasks".

**Created automatically** when a `detected_events` row of type `interview`,
`assessment` or `offer` is linked to a saved job in status `pending`,
`applied` or `auto_applied`. Default titles: "Interview: reply and prepare",
"Assessment to do", "Offer: respond".

**Removed automatically** (if still open) when that event is dismissed
("Not this") or re-pointed at another job. Undo of a dismissal re-creates it.

**State**: open → done (`done_at` set) → open again (cleared). Deleting is
allowed for any task; deleting an email-made task does not bring it back on the
next scan (the unique event id is remembered by keeping the row with
`done_at` set instead of deleting when `source_event_id` is present).

**Validation**: `title` 1–200 chars; `kind` from the list; `due_at` any time
(past dates show as overdue); the saved job must belong to the user (404
otherwise, no leak).

## saved_jobs

- `pipeline_stage_id`: backfill every NULL to the user's first stage (lowest
  `position`), and make `save_job` / `save_manual_job` default to it. The column
  stays nullable (a deleted stage sets it NULL); the board then shows the job in
  the first stage rather than hiding it.
- List responses gain `open_tasks` (see contracts), filled by one grouped query.

## detected_events

- `acted_at` timestamptz, null (new): when the event was applied, auto-applied,
  dismissed or undone. Backfilled from `applied_at`, else `created_at`. Orders
  the History tab and bounds it to 30 days.
- `acted_by` String(10), null (new): `auto` or `user`, so History can say
  "moved automatically" vs "you moved it".

No status values change. History = `applied`, `auto_applied`, `dismissed` with
`acted_at` in the last 30 days.

## email_accounts — scan progress

| Column | Type | Notes |
|---|---|---|
| `scan_state` | String(10), default `idle` | `idle` · `running` · `done` · `stopped` |
| `scan_started_at` | timestamptz, null | |
| `scan_heartbeat_at` | timestamptz, null | updated after each batch; older than 90 s while `running` reads as `stopped` |
| `scan_progress` | JSON, null | `{"checked": n, "found": n, "moved": n, "folder": "Inbox"}` — counts only, never email content |
| `scan_message` | String(200), null | plain reason when stopped ("Yahoo asked us to slow down") |

The in-memory `_SCAN_LOCKS` guard stays (one scan per account per process);
these columns are what the page reads.

## Not stored

- Suggested follow-ups: computed in `frontend/src/lib/nextAction.ts`.
- Collapsed columns, last view (list/board), dismissed checklist steps: browser
  `localStorage`, per device.
- Search text and filters: page state. `?q=…` in the link pre-fills the search,
  so a searched board can be linked.
