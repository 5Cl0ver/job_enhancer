# Data model: 012

There is one migration, `j8e9f0a1b2c4_scout_results_levels`. Every new column
is nullable or has a server default, so existing rows stay valid. RLS stays
unchanged because these are existing tables.

## resume_tracks (+2)

| Column | Type | Default | Notes |
|---|---|---|---|
| `levels` | JSON | `["entry","mid"]` | A subset of entry, mid and senior, never empty. Existing rows get Entry + Mid. |
| `years` | SmallInteger, nullable | null | The user's years of experience (0–40), used by the level cap. |

## scout_findings (+8)

| Column | Type | Notes |
|---|---|---|
| `location` | String(120), nullable | From the page copy when there is one, else Claude's reading. |
| `level` | String(10), nullable | entry, mid, senior or lead (Claude's reading). |
| `years_asked` | SmallInteger, nullable | 0–30. |
| `posted` | String(40), nullable | e.g. "3 days ago". |
| `in_area` | Boolean, nullable | False → outcome `too_far`. |
| `claude_fit` | SmallInteger, nullable | Claude's score before the level cap. `fit_score` is after the cap. |
| `facts_from` | String(10), default `copy` | `copy` or `claude`: tells the user where the title and company came from. |
| `passed_at` | DateTime, nullable | Set when the user passes on the job in Results. |

There is a new outcome, `too_far`. It doesn't count toward the target, and it's
remembered so the job isn't reported again. 012 doesn't add a new
"undecided" state: the existing outcomes map to the four statuses below.

**Statuses** (worked out, not stored):

- new: `picked`, `below_bar`, `no_copy`, `waiting_for_copy`
- saved: `saved`, or `duplicate` with a job in My Jobs
- passed: `skipped`
- hidden: `duplicate` with no job in My Jobs, or `too_far`

**Band** (worked out from `fit_score` against the run's `min_fit`):

- `best` when the score is at least the bar
- `possible` when it's at least the bar minus 2
- `long_shot` otherwise

## scout_companies (+1)

| Column | Type | Notes |
|---|---|---|
| `last_openings` | JSON, nullable | Up to 20 entries of `{title ≤200, url ≤2000, fit 0–10 or null}` from the latest check. |

## scout_runs (no new columns)

New keys in `criteria.track`:

- `levels`
- `years`
- `suggested`: titles Claude added for this run

New keys per entry in `stats._links[i]`:

- `widened_days`: the window the search was widened to
- `base_total`: the result count before widening

## Validation

- Facts are trimmed and cut to their lengths. Each one is optional.
- Level values outside the list become null.
- `levels` must be a non-empty subset of the three.
- Suggested titles: at most 4, each 100 characters or less. Senior-sounding
  titles are dropped unless Senior is chosen.
