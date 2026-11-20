# Data Model: Know where every job came from and where it went

Two migrations, one per step that needs one, each on top of the last
(`b9c0d1e2f3a5` is PR #15's):

- `c0d1e2f3a4b6_saved_job_origin` (step 1): `saved_jobs.origin` and its backfill.
- `d1e2f3a4b5c7_scout_review` (step 2): `scout_missions.collection_id`,
  `auto_save`, and `scout_runs.stats`.

All columns are nullable or have a server default, so both are safe on a live
table and reversible. No new tables.

## `saved_jobs` (changed)

| Column | Type | Notes |
|---|---|---|
| `origin` | `varchar(12)` null | `scout` · `email` · `extension` · `claude` · `search` · `manual`. Null = unknown (older jobs the app can't place). The six values are enforced in code (`ORIGINS`); a request can only ever say `manual` or `extension`. |

Set by the code path that creates the saved job:

| Path | Origin |
|---|---|
| `scout_runs` confirm / save-one / auto-save | `scout` |
| `email_review.track_event` | `email` |
| `POST /saved-jobs/manual` with `origin: "extension"` (Job Catcher), `sync_applications` imports | `extension` |
| MCP `save_job` | `claude` |
| `POST /saved-jobs` (from a job-board result) | `search` |
| `POST /saved-jobs/manual` from the web form | `manual` |

Saving a job the user already has never changes its origin (first one wins).

**Backfill** (in the migration, certain cases only):

1. `scout` where a `scout_findings.saved_job_id` points at the job.
2. `email` where the job's listing `apply_url` host is `mail.yahoo.com`,
   `mail.aol.com` or `mail.google.com` (only `track_event` writes such links).
3. `search` where the listing's `source` is a job-board feed (anything but
   `manual`).
4. Everything else stays null.

## `scout_missions` (changed)

| Column | Type | Notes |
|---|---|---|
| `collection_id` | `uuid` null, FK `collections.id` `ON DELETE SET NULL` | **Save into**. Null = the folder named after the search's resume type, made on first save. |
| `auto_save` | `boolean` not null default `false` | Save good fits without asking. |

Both are copied into `scout_runs.criteria` when a run is queued, like the other
search settings, so editing a search mid-run doesn't change that run.

## `scout_runs` (changed)

| Column | Type | Notes |
|---|---|---|
| `stats` | `json` null | Running totals from `check_jobs`: `{"rows": 24, "in_tracker": 2, "seen_before": 9, "excluded": 4}`. Added to on every call. Null on runs from before this ships (their line shows findings only). |

Counts only; no titles, companies or links. The per-finding reasons (below the
bar, no copy, duplicate) still come from `scout_findings`.

## `scout_findings` (changed values, no new columns)

`outcome` gains two values (the column is already `varchar(20)`):

| Outcome | Meaning | Counts as seen | Counts toward target |
|---|---|---|---|
| `picked` (new) | At or above the bar, copy in hand, waiting for the user | yes | yes |
| `skipped` (new) | Was a pick; the user confirmed without it | yes | — |
| `saved` | In My Jobs (`saved_job_id` set) | yes | yes |
| `below_bar` | Under the bar or failed a hard rule | yes | no |
| `duplicate` | Already in My Jobs | yes | no |
| `waiting_for_copy`, `no_copy` | As today | no | no |

### Transitions

```text
report_job ─┬─ fit ≥ bar, auto_save off ─→ picked ──confirm (ticked)──→ saved
            │                                └──confirm (unticked)─→ skipped ──save one──→ saved
            ├─ fit ≥ bar, auto_save on ──→ saved
            ├─ fit < bar / hard rule ────→ below_bar ──save one / confirm (ticked)──→ saved
            └─ already saved ────────────→ duplicate
```

- A finding can be saved only while its `scout_captures` row exists (the page
  copy is the description). No copy → not saveable.
- Saving goes through `save_manual_job`, so a job the user already has is
  matched, not duplicated; the finding then becomes `duplicate` with a link to
  the existing job.
- A run "needs review" while it has at least one `picked` finding. That count
  is what `/attention` reports.

## Folder resolution (no schema)

`scout_folder(run, override)` picks, in order: the folder named in the confirm
request (id, or a new name → created) → the run's `collection_id` if it still
exists → the user's folder named after the run's resume type (created if
missing) → the "Scout" folder (only when the run has no resume type).

## `saved_jobs` (changed again, step 3)

Migration `e2f3a4b5c6d8_saved_job_own_names`: four nullable columns.

| Column | Type | Notes |
|---|---|---|
| `custom_title` | `varchar(500)` null | The user's own title for the job |
| `custom_company` | `varchar(255)` null | |
| `custom_location` | `varchar(255)` null | |
| `custom_apply_url` | `text` null | http(s) only |

Shown in place of the listing's values for that user only; the listing is
never edited (research R6). Any of them set = the user has checked the name.

A name is **doubtful** (computed, not stored) for an email-made job with no
override when the title's first word is all lower case or it talks to the
reader ("we", "your", "invited"…), or when the company is the person who sent
one of the job's emails (their name, at a personal address that isn't a
hiring system's).

## Client state

| Where | Key | Meaning |
|---|---|---|
| URL | `/jobs?folder=<id>&origin=<origin>` | My Jobs filtered; linkable |
| URL | `/search?tab=scout&view=history&run=<id>` | History opened on one run (exists; now linked to) |
