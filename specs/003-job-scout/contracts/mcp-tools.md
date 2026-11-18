# Contract: Scout tools on the MCP connector

Added to `backend/app/mcp_server.py` beside `save_job`/`list_jobs`. Same auth
(Supabase OAuth, the signed-in user only). None of them can change a pipeline
stage or mark anything applied.

Design rules (research R8, R9):

- **Small in, small out.** Every reply is a few hundred tokens at most, whatever
  the size of the tracker. No tool ever returns a list of everything seen.
- **Claude never copies a job.** The exact listing (title, company, location,
  pay, posted date, full description, link) is captured from the page by the Job
  Catcher extension, or fetched from the company's public job feed. Claude
  sends only a link and its opinion (fit, why, gaps).
- **Same line every time.** The user's prompt never changes: "Do my next Job
  Scout run with the Job Enhancer connector." The app knows which run is next.

## get_scout_brief(run_id: str | None = None) -> dict

First call of every chat. With no id: the oldest `running` run, else the oldest
`queued` one (marked `running`). Safe to call again: a fresh chat on a
half-done run gets the progress and carries on.

```json
{
  "run_id": "7f3c",
  "playbook": "…short versioned rules (≈ 400 words)…",
  "playbook_version": "2026.11.2",
  "source": "linkedin",
  "start_urls": ["https://www.linkedin.com/jobs/search/?keywords=…&f_TPR=r604800&sortBy=DD"],
  "track": {"name": "IT Admin", "titles": ["…"], "skills": ["…"], "skip": {"degree_only": true, "max_years": 7, "exclude": ["…"]}, "notes": "…"},
  "rubric": {"skills": 4, "experience": 2, "title_level": 2, "recency": 1, "pay_location": 1},
  "min_fit": 6,
  "progress": {"saved": 2, "target": 5, "pages_left": 6},
  "next": "Open the first start URL and send its job rows to check_jobs."
}
```

Never includes saved jobs, past findings or company lists. The app builds the
search URL, so Claude doesn't click through filters.

## check_jobs(run_id, rows: list[{company, title, url?}]) -> dict

One call per results page (≤ 25 rows, as read from the list). Returns only the
rows worth opening, by position:

`{"open": [0, 3, 7], "skipped": {"in_tracker": 4, "seen_before": 9, "excluded": 2}}`

Dedupe (research R3) and the track's exclude words run here, server-side.

## report_job(run_id, url, fit_score, why_fit, gaps) -> dict

Called while the posting is open in the tab. Claude sends no job text.

- The app looks for the page copy the extension captured for that link (or
  fetches it from Greenhouse / Lever / Ashby by job id).
  - **Found** → dedupe on the exact company + title; then `saved` (into the
    "Scout" folder, tagged with the track) or `below_bar` (remembered, not saved).
  - **Not found yet** → `{"outcome": "waiting_for_copy", "next": "Stay on the posting page and call report_job again."}` (the extension posts within a couple of seconds of the page loading).
  - **Still not found on the second call** → `no_copy`: the finding is kept,
    the job is *not* saved, and the run page shows "Open this job and press Save"
    (the extension isn't installed, or the page has no readable posting).
- A search page or careers homepage link → `rejected_link` with the reason.
- `fit_score` 0–10; `why_fit`, `gaps` ≤ 600 chars each — Claude's opinion,
  stored and shown labelled as Claude's.
- Returns `{"outcome": "...", "saved": 3, "target": 5, "done": false, "next": "…"}`.

## log_company(run_id, name, careers_url=None, ats="unknown", employer_type=None, city=None, result="no_fit") -> dict

Local runs only. Upserts `scout_companies` by `name_key`; sets
`last_checked_at`, `last_result`, `checks += 1`. Returns
`{"next_company": {"name": "…", "careers_url": "…"} | null, "find_new": 3}` —
the app hands out companies **one at a time**, never the whole log.

## finish_scout_run(run_id, note: str = "") -> dict

`running → done`; stores Claude's note (≤ 500 chars, e.g. "CAPTCHA after 3");
returns the counts and whether another queued run is waiting.
