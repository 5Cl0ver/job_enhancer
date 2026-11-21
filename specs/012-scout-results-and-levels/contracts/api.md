# Contracts: 012

Every route needs the user's Supabase login (Bearer), and every query is
limited to that user. Field limits are as in data-model.md.

## App API (`/api/v1/scout`)

### GET /findings

Returns the user's findings for Results, best first.

**Query parameters:**

| Parameter | Values | Default |
|---|---|---|
| `run` | a run id, `last`, or `all` | all runs |
| `track` | a track id | all types |
| `status` | new, saved, passed or hidden | new |
| `sort` | fit or newest | fit |
| `limit` | up to 200 | 100 |
| `offset` | where the page starts | 0 |

**Response `200`:**

```json
{
  "items": [{
    "id": "…", "run_id": "…", "run_name": "LinkedIn · IT Admin", "track_id": "…",
    "title": "…", "company": "…", "location": "…", "level": "mid",
    "years_asked": 3, "posted": "2 days ago", "url": "…",
    "fit": 7, "claude_fit": 7, "band": "best", "min_fit": 6,
    "why_fit": "…", "gaps": "…", "app_note": null,
    "status": "new", "outcome": "picked", "facts_from": "copy",
    "can_save": true, "job_listing_id": null, "found_at": "…"
  }],
  "counts": {
    "best": 4, "possible": 3, "long_shot": 5,
    "new": 12, "saved": 2, "passed": 1, "hidden": 3
  },
  "next": null
}
```

`next` is the `offset` of the next page, or null on the last one. A job found
by more than one run is listed once, as its latest finding. Counts per group
are for the chosen status; counts per status cover every status.

### POST /findings/{id}/pass → `200` with the finding

Sets the outcome to `skipped` and fills `passed_at`. This works on any `new`
finding (`409` otherwise).

### POST /findings/{id}/restore → `200` with the finding

Undoes a pass: back to `picked` or `below_bar` by its score, or `no_copy` when
there is no page copy.

### POST /findings/{id}/save

The existing route. It now also accepts `no_copy` and `waiting_for_copy`
findings once a page copy exists (one that arrived after Claude moved on).
Without a page copy it returns `409`.

### GET /recommended → `200`

```json
{
  "mission": {"job_count": 10, "posted_within_days": 7, "min_fit": 6, "radius_miles": 25},
  "track": {"levels": ["entry", "mid"], "skip": {"degree_only": false}}
}
```

### GET /runs and GET /runs/{id}

`RunOut` gains:

- `bands: {best, possible, long_shot}`
- `hidden: {repeats, too_far}`
- `not_copied`
- `suggested_titles: [str]`
- `widened: [{title, days}]`
- `looking_for`: source, track, levels, location, radius, remote, days, bar

### PATCH /tracks/{id}

Accepts `levels` and `years`. `TrackOut` returns them.

## Connector tools (Claude)

### report_job(run_id, url, fit_score, why_fit, gaps, …)

New optional arguments:

- `title`, `company`, `location`
- `level` (entry, mid, senior or lead)
- `years_asked`
- `posted`
- `in_area`

**What the app does with them:**

- `in_area: false` on a search with a place → `too_far` (the brief's
  `area.rule` tells Claude when a job counts, remote included).
- A level above the user's levels caps the fit (see research R4). The answer
  says so: `"note": "Lowered to 5: senior role, you chose Entry–Mid"`.
- With no page copy after 3 reports → `no_copy`, but it keeps the facts and the
  score.

### set_search_titles(run_id, titles)

It now also works for a scoped run whose brief has `suggest_titles` (up to that
many extra titles). It returns `start_urls` and `searches`.

### company_checked(…, openings?)

`openings` is a list of up to 20 `{title, url, fit?}` entries: the jobs Claude
saw on the careers page. Kept only with result `openings`.

### get_scout_brief

`track` gains `levels` and `years`. There are 3 new fields:

- `suggest_titles` (int, only when the type has no related titles and there
  is a resume to suggest from)
- `level_rule` (plain words)
- `area`: `{location, radius_miles, remote_ok, rule}` for a search with a place

LinkedIn `start_urls` carry `f_E` for the levels.

### check_jobs

When a search is thin (research R5), `next_page_url` may be the same search
with a widened window, and the answer says "widened to 3 days".
