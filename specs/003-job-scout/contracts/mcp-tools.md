# Contract: Scout tools on the MCP connector

Added to `backend/app/mcp_server.py` beside `save_job`/`list_jobs`. Same auth
(Supabase OAuth, the signed-in user only). None of them can change a pipeline
stage or mark anything applied.

## get_scout_brief(run_id: str) -> dict

First call of every run. Marks a `pending` run `running`. Safe to call again
(resume after a dropped connection).

```json
{
  "run_id": "…",
  "playbook": "…versioned instructions: how to browse, what a posting link is, how to score…",
  "playbook_version": "2026.11.1",
  "source": "linkedin",
  "job_count": 5,
  "posted_within_days": 7,
  "min_pay": 70000,
  "min_fit": 6,
  "location_rule": {"zone": ["Springfield", "Riverton", "…"], "remote": "local_company_only"},
  "track": {
    "name": "IT Admin",
    "target_titles": ["IT Systems Administrator", "Jira Administrator", "…"],
    "key_skills": ["Microsoft 365", "Entra ID", "…"],
    "skip_rules": {"degree_only": true, "max_years": 7, "exclude": ["clearance", "SAP"]},
    "notes": "…"
  },
  "rubric": {"skills": 4, "experience": 2, "title_level": 2, "recency": 1, "pay_location": 1},
  "already_reported_this_run": 2,
  "skip": {
    "jobs": [["acme", "it systems administrator"], "…company_key/title_key pairs…"],
    "urls": ["linkedin.com/jobs/view/123", "…"]
  },
  "companies": {                     // local_companies source only
    "due": [{"name": "…", "careers_url": "…", "ats": "greenhouse", "hot": true}],
    "find_new": 10,
    "employer_types": ["credit union", "law firm", "…"],
    "avoid": ["…every known company name_key, incl. blocked…"]
  }
}
```

`skip.jobs` is capped (most recent 1,000); `check_job` is the authority.

## check_job(company: str, title: str, url: str | None) -> dict

Cheap pre-check before reading a full posting.
`{"seen": true, "why": "already in your tracker (Applied)"}` or `{"seen": false}`.

## report_job(run_id, company, title, url, location, description, fit_score, why_fit, gaps, posted_on=None, salary_min=None, salary_max=None, salary_period=None, is_remote=False) -> dict

- Rejects (outcome `rejected_link`) a URL that is a search/list page or a
  careers homepage, with a reason the agent can act on.
- Duplicate → outcome `duplicate`, nothing saved.
- `fit_score < min_fit` → `below_bar`, remembered, not saved.
- Otherwise saves through the same service as `save_job` (verbatim
  description), into the "Scout" collection, with `track_id`, and notes
  `Fit 8/10 (Strong) · LinkedIn · Posted 2026-11-17 · Why: … · Gaps: …`.
- Returns `{"outcome": "...", "job_id": "...?", "saved_so_far": 3, "target": 5, "done": false}`.

Validation: fit 0–10; `posted_on` ISO date or null; description required for
`saved` (≥ 200 chars, else `below_bar` is not used — it returns an error asking
for the full text).

## log_company(run_id, name, careers_url=None, ats="unknown", employer_type=None, city=None, result="no_fit") -> dict

Upserts `scout_companies` by `name_key`; sets `last_checked_at`, `last_result`,
`checks += 1`; `hot` becomes true if any job from this company was saved.

## finish_scout_run(run_id, summary: str) -> dict

`running → done`; stores the summary; returns the counts the page shows.
