# Contracts: Sites to skip

## REST (the app, owner only)

| Route | Result |
|---|---|
| `GET /v1/skipped-sites` | `[{id, host, created_at}]`, newest first |
| `POST /v1/skipped-sites {site, confirm?}` | 201 `{id, host}`. 200 "already on your list". 400 when it isn't a site. 409 `{needs_confirm: true, why}` when the site is one Scout searches and `confirm` isn't true. 400 past 100. |
| `DELETE /v1/skipped-sites/{id}` | 204 |
| `GET /v1/skipped-sites/suggestions` | `[{host, finds}]`: known reposting sites seen in the user's Scout finds, minus ones already skipped |

## Connector (no new tools)

| Tool | Change |
|---|---|
| `get_scout_brief` | Adds `skip_sites: ["learn4good.com", …]` and one playbook line: "Never use links on skip_sites; on Google Jobs pick another 'Apply on' choice or the company's own page." |
| `check_jobs` | Rows whose link host matches are not offered to open; counted as `skipped_site`. |
| `report_job` | A link on a skipped site is refused: "{host} is on the user's sites to skip. Use the company's own posting, or another 'Apply on' link." |
| `get_apply_brief` | When the job's apply link is on a skipped site: `apply_url_skipped: true` and a `next` line telling Claude to find the company's own posting (or `need_help`). |

## App UI

| Where | What |
|---|---|
| Claude Scout › Instructions | A new "Sites to skip" section (a small card above the editable texts): an add box ("Paste a link or a site"), the list with ✕, and suggestions with "Skip it". |
| Settings | A link to the section. |
| Job page | "Never this site" in the job's ⋯ actions, only for a job with a link. |
