# REST and connector contract: Know where every job came from and where it went

All routes are under `/v1`, need the user's bearer token, and only ever touch
that user's rows. Errors use the app's usual `{ "detail": "…" }`.

## Saved jobs

### Changed: saved job list and detail

`SavedJobOut` and the list summary gain:

```json
{
  "origin": "scout",
  "scout": { "fit_score": 8, "run_id": "…" },
  "name_doubtful": false
}
```

- `origin`: `scout | email | extension | claude | search | manual | null`.
- `scout`: only for `origin = "scout"`; from the finding that saved the job.
- `name_doubtful`: only ever true for `origin = "email"`.

### Changed: `POST /saved-jobs/manual`

Body gains optional `origin`: `"manual"` (default) or `"extension"`. Any other
value is a 422; the other origins can only be set by the server.

### New: `GET /saved-jobs/{id}/source`

Everything the job page's "Where this came from" block needs, in one request.

```json
{
  "origin": "scout",
  "saved_at": "2026-11-19T15:02:11Z",
  "collection": { "id": "…", "name": "IT Admin" },
  "scout": {
    "run_id": "…", "finding_id": "…", "source": "linkedin",
    "search_name": "LinkedIn · IT Admin · 5 jobs",
    "fit_score": 8, "why_fit": "…", "gaps": "…",
    "found_at": "2026-11-19T15:01:40Z"
  },
  "email": null
}
```

For `origin = "email"`, `email` is the event that made the job:
`{ "event_id", "event_type", "email_date", "mail_link", "mail_search_link" }`
(same link rules as PR #15) and `scout` is null. Other origins return both
null. 404 if the job isn't the user's.

### New: `PATCH /saved-jobs/{id}/listing`

```json
{ "title": "Platform Engineer", "company": "Vellacor", "location": "Austin, TX", "apply_url": "https://…" }
```

All fields optional; at least one required. Title 1–500, company 1–255,
`apply_url` must be http(s). Returns the updated `SavedJobOut`.

- Edits in place when the listing is manual and only this user has it;
  otherwise copies the listing first ([data-model.md](../data-model.md)).
- **409** `"You already have this job saved."` when the new name matches another
  of the user's saved jobs.

## Scout

### Changed: missions

`MissionIn` / `MissionOut` gain `collection_id` (uuid or null) and `auto_save`
(bool, default false). `MissionOut` also returns `collection_name`: the chosen
folder's name, or the name the default folder will have.
A `collection_id` that isn't the user's is a 404.

### Changed: `RunOut`

```json
{
  "counts": { "picked": 2, "saved": 0, "skipped": 0, "below_bar": 3, "duplicate": 1 },
  "needs_review": true,
  "target": 5,
  "looked_at": { "rows": 24, "in_tracker": 2, "seen_before": 9, "excluded": 4 },
  "folder": { "id": "…", "name": "IT Admin" },
  "findings": [
    { "id": "…", "outcome": "picked", "title": "…", "company": "…", "url": "…",
      "fit_score": 8, "why_fit": "…", "gaps": "…", "app_note": null,
      "can_save": true, "saved_job_id": null,
      "collection_id": null, "collection_name": null }
  ]
}
```

- `can_save`: the page copy exists and the finding isn't already saved.
- `looked_at`: totals from the results pages Claude checked; null on older runs.
- `folder`: where a confirm would put jobs by default; `id` is null when the
  default folder doesn't exist yet.

### New: `POST /scout/runs/{run_id}/confirm`

```json
{ "finding_ids": ["…", "…"], "collection_id": "…", "new_collection_name": null }
```

- Saves each listed finding that `can_save`; every `picked` finding of the run
  that is **not** listed becomes `skipped`.
- Give `collection_id`, or `new_collection_name` (1–100 chars; reuses a folder
  of the same name), or neither for the run's default. Both → 422.
- Works whatever the run's status (running, done, stopped).
- Idempotent: confirming again with the same ids saves nothing new.

```json
{
  "saved": [{ "finding_id": "…", "saved_job_id": "…" }],
  "already": [{ "finding_id": "…", "saved_job_id": "…" }],
  "failed": [{ "finding_id": "…", "reason": "The page copy is gone." }],
  "folder": { "id": "…", "name": "IT Admin" }
}
```

### New: `POST /scout/findings/{finding_id}/save`

Body `{ "collection_id": null, "new_collection_name": null }`. Saves one
finding (a `skipped` or `below_bar` one, from History). Returns one entry in the
shape of `saved` / `already` above plus `folder`. **409** when there is no page
copy.

### Changed: `GET /attention`

Gains `"scout_review": 2` (count of `picked` findings across the user's runs).
Counts only, as today.

## Connector (what Claude sees)

Same four tools, same sizes. Wording changes only:

| Tool | Change |
|---|---|
| `get_scout_brief` | New `saving` line: "Good fits are kept in the app for the user to tick and save. You never save a job yourself…" With `auto_save` on: "Good fits are saved straight into the user's collection." Playbook 2026.11.3 adds one step saying the same. |
| `report_job` | `outcome` may be `picked`. The progress key is now `kept` (picks + saved), not `saved`, so nothing in a reply reads as "saved" when it wasn't; the target is reached the same way. `next` unchanged. |
| `finish_scout_run` | `next` gives the sentence to say: "N jobs are waiting in Job Enhancer (Find Jobs > Claude Scout) for them to tick and save. Don't say anything was saved." (or "N jobs were saved to My Jobs" with `auto_save`). |
| `check_jobs` | `picked` and `skipped` count as seen. |

`save_job` (chat, outside Scout) is unchanged apart from stamping
`origin = "claude"`.
