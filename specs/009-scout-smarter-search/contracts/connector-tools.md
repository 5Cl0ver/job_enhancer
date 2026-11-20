# Connector tools (Claude in Chrome ⇄ app): changes in 009

Every tool runs as the signed-in user, and every answer is small and constant
in size (research R8 of 003).

## get_scout_brief (changed)

These are added to the answer for every run:

| Key | Type | Meaning |
|---|---|---|
| `resume_ready` | bool | The user has an active resume with text. If it's true, call `get_master_profile` once now and score against it. |

For a **broad** run:

| Key | Type | Meaning |
|---|---|---|
| `broad` | true | |
| `broad_steps` | str | The steps in `app/scout/broad.md` |
| `start_urls` | `[]` | Empty until `set_search_titles` is called |
| `titles_tried` | `[{title, runs, good_fits, resting}]` | At most 30 entries: good fits first, then the most recent |
| `always` / `never` / `avoid` | `[str]` | The user's overrides for this search |
| `resume_types` | `[{name, titles}]` | The user's resume types, with up to 4 titles each, for choosing `resume_type` in `report_job` |
| `max_titles` | 8 | |
| `next` | str | "Call get_master_profile, choose up to 8 titles…, then call set_search_titles." |

## set_search_titles (new)

```
set_search_titles(run_id: str, titles: list[str]) -> dict
```

Broad runs only. Any other run gets a `ValueError` saying it isn't a broad
search.

The answer:

```json
{
  "titles": ["IT Systems Administrator", "Microsoft 365 Administrator", "…"],
  "dropped": [{"title": "Help Desk Technician", "why": "never_search"},
              {"title": "Desktop Support", "why": "resting"},
              {"title": "…", "why": "over_the_limit"}],
  "start_urls": ["https://www.linkedin.com/jobs/search/?keywords=…"],
  "progress": {"kept": 0, "target": 5, "done": false},
  "next": "Open the start URL and send the first page of rows to check_jobs."
}
```

- The possible `why` values are `never_search`, `resting` and
  `over_the_limit`. A title sent twice is searched once.
- Called again after a results page was checked, it returns the run's current
  titles and links with `"note": "This run's titles are set."`.
- If every title is dropped and there are no Always titles, it returns a
  `ValueError`: "None of these can be searched (…). Choose other titles."
- Local companies: `start_urls` are the Google searches for local businesses,
  built with these titles.

## report_job (changed)

```
report_job(run_id, url, fit_score, why_fit, gaps, resume_type: str = "")
```

- `resume_type` applies to broad runs only. It's the name of the user's
  closest resume type from the brief, or empty for none. Unknown names count
  as none, and no error is raised.
- The answer is unchanged.

## check_jobs / finish_scout_run

- No change to inputs or outputs.
- On a broad run, Avoid words count as `excluded`, as the resume type's skip
  words do.
