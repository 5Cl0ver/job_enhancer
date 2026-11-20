# Data Model: Claude Scout finds better jobs (009)

One migration, `g5b6c7d8e9f1` (revises `f4a5b6c7d8e0`), adds or changes the
following. Nothing existing is removed. RLS is enabled on the new table, and
every row is scoped to its user.

## resume_tracks (changed)

| Column | Type | Notes |
|---|---|---|
| `kind` | String(10), NOT NULL, server default `'scoped'` | `'scoped'` (a resume type the user made) or `'broad'` (the hidden "Anything I'd be good at" track; at most one per user) |

- Lists, the Resume types page, the 8-track limit and name checks only see
  `kind = 'scoped'`.
- The broad track is created on first use with the reserved name "Anything
  I'd be good at" and empty titles, skills and skip rules. The user can't
  rename, edit or delete it (any attempt returns 404, as for another user's
  track).
- A scoped track can't take the reserved name (422).

## scout_missions (changed)

| Column | Type | Notes |
|---|---|---|
| `overrides` | JSON, nullable | `{"always": [str], "never": [str], "avoid": [str]}`, each list up to 20 entries of up to 80 characters, tidied and de-duplicated without regard to case. Null or empty lists mean Claude decides alone. Only meaningful on broad missions. |

`MissionCreate` / `MissionUpdate` take `broad: bool`. When true, `track_id` is
ignored and set to the user's broad track. `MissionOut` adds `broad` and
`overrides`.

## scout_runs.criteria (JSON, new keys)

| Key | When | Meaning |
|---|---|---|
| `broad` | always | True for a broad mission |
| `overrides` | broad | Snapshot at queue time (FR-017) |
| `search_titles` | broad, after `set_search_titles` | The titles this run searches (at most 8). `search_titles(c)` returns these for broad runs. |
| `track.skip.exclude` | broad | Includes the Avoid words |

## scout_findings (changed)

| Column | Type | Notes |
|---|---|---|
| `search_title` | String(200), nullable | Broad runs: which searched title this good fit is credited to (research R5) |
| `closest_track_id` | UUID, FK `resume_tracks.id` ON DELETE SET NULL, nullable | Broad runs: the resume type Claude said is closest (R6); saving tags the job with it |

## scout_titles (new)

One row per broad search and title tried.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK users CASCADE, indexed | |
| `mission_id` | UUID FK scout_missions CASCADE | Deleting a search forgets its titles |
| `title` | String(200) | As Claude (or the user) wrote it, first time seen |
| `title_key` | String(200) | Normalised (008's `title_key`) |
| `runs` | Integer, default 0 | Runs that searched it |
| `good_fits` | Integer, default 0 | Good fits credited to it |
| `last_tried_at` | timestamptz, nullable | |
| `created_at` | timestamptz | |

- Unique (`mission_id`, `title_key`).
- **Resting** is computed: `runs >= 3 and good_fits == 0 and last_tried_at >
  now - 14 days`, never for a title in the mission's Always list.

## RunOut (API shape)

- `titles: [{title, good_fits}]`: broad runs only, in the order searched. Good
  fits are counted from this run's findings by `search_title`.
- `broad: bool`

## FindingOut (API shape)

- `closest_track_name: str | None`: broad runs only, shown in the review.

## Rules (validation)

- `set_search_titles` input:
  - 1–20 strings of up to 120 characters; blank or non-text entries are
    ignored.
  - The result is Always titles first, then Claude's in order, minus Never,
    resting and duplicates (by `title_key`), capped at 8.
- If the result is empty, the tool returns an error asking for other titles,
  and the run's titles stay unset.
- Once a results page has been checked, the run's titles are fixed (R3).
