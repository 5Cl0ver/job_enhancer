# Contracts: Apply with best judgment

## REST

| Route | Who | Change |
|---|---|---|
| `GET /v1/apply/active` | Job Catcher | Adds `resume_id` (the run's résumé, else the job's) and `live: true` while the status is filling or needs_you |
| `POST /v1/apply/runs/{id}/live` `{url, title, boxes}` | Job Catcher | 204. 409 when the run isn't filling. 400 when the URL isn't on the run's site. Replaces `live` |
| `GET /v1/apply/runs/{id}` | App | Adds `live`, page answers' `guess` / `agreement` / `by`, the fill and photo problems in plain words (`problems: [{page_n?, text, kind}]`) and `resume_file: {id, filename}` |
| `POST /v1/apply/runs/{id}/decision` | App | Adds `fixes: [{page, q, a, to?, ask?}]` (optional; with decision `fix`) |
| `POST /v1/apply/requests/{id}/result` | Job Catcher | fill: `resume`; photo/peek: the new reason codes |

## Connector (no new tools)

| Tool | Change |
|---|---|
| `fill_page` | The result adds `resume` with a `tell` line ("Your résumé is attached" / "No résumé box on this page" / "Couldn't attach: call need_help(kind='file')") |
| `page_done`, `ready_for_review` | `answers[]` items accept `guess` and `agreement`; the result says in plain words why there are no photos |
| `need_help` | `kind` accepts `file` |
| `wait_for_you` | A fix decision returns `fixes` |
| `get_apply_brief` | The playbook and rules: best judgment (version 2026.11.27) |

## App UI

| Where | What |
|---|---|
| Application page, while filling | **Filling now**: page title, then each box: question, value, and a "Job Catcher" chip. It updates by itself |
| Claude needs you, kind file | The reason, **Download your résumé for this job**, and the reply box ("I attached it" / Try again) |
| Pages | A plain line instead of photos when there are none, with the reason |
| Review | **Check these first**: agreements and guesses as bubbles; then every page's bubbles. Tap → Change it to / Ask Claude. A tray: "N fixes · Send fixes". Submit stays where it is |
