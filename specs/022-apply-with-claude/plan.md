# Implementation Plan: Apply with Claude

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Technical context

- **Backend:** FastAPI, SQLAlchemy 2 async, Alembic, the FastMCP connector (`app/mcp_server.py`), and fpdf2 (the PDF maker in `api/v1/ai.py`).
- **Frontend:** Vite, React, TanStack Query and shadcn/ui.
- **Extension:** MV3 (esbuild content and background scripts, plus the Vite panel).
- **Tests:** pytest (SQLite), vitest, and the extension's vitest and Playwright suites.
- **Migration:** one, `s7b8c9d0e1f3_apply_runs`, after `r6a7b8c9d0e2`.

## PRs

| Part | Branch | What |
|---|---|---|
| A | `022-apply-with-claude` | Spec docs. Job Catcher capture fixes (US1). Extension 0.39.0. |
| B | `022-apply-runs` | Migration, models, services, REST routes, connector tools, the playbook and rules, master résumé, things told to Claude, résumé PDF save (US2–US7 server side). |
| C | `022-apply-app` | Apply with Claude button, application page, top banner, Settings › Résumés, What you sent (US2–US8 in the app). |
| D | `022-apply-job-catcher` | Job Catcher apply mode: find runs, photos, fill on request, Submit block, notice Submit. Extension 0.40.0. |

B ships before C and D. C and D only call B's routes.

## Data model (part B)

**`apply_runs`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | fk users, cascade, indexed | |
| `saved_job_id` | fk saved_jobs, cascade | |
| `status` | str(20) | `waiting`, `reading`, `questions`, `writing`, `filling`, `needs_you`, `review`, `submitting`, `sent`, `not_sent`, `stopped` |
| `questions` | JSON list | `{id, question, why, answer, skipped, source: app\|chat, answered_at}` |
| `answers_done` | bool | The user pressed "Done, make my résumé". |
| `pages` | JSON list | `{n, url, title, answers:[{q,a,claude?}], jc_answers:[{q,a}], photo_ids:[], photo:"taken"\|"missing", reason, at, round}` |
| `help` | JSON nullable | `{kind, what, at, done_at}` |
| `review` | JSON nullable | `{round, decision: null\|submit\|fix\|self, note, by: app\|chat, at}` |
| `events` | JSON list | Timeline, at most 200: `{at, kind, text}` |
| `resume_id` | fk resumes, set null | |
| `document_id` | fk generated_documents, set null | |
| `apply_hosts` | JSON list | Hosts the Submit block covers. |
| `note` | text | |
| `playbook_version` | str(20) | |
| `created_at`, `started_at`, `last_activity_at`, `finished_at` | timestamps | |

**`apply_requests`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `run_id` | fk apply_runs, cascade, indexed | |
| `kind` | str | `photo` or `fill` |
| `url` | text | |
| `page_n` | int | |
| `status` | str | `pending`, `working`, `done`, `failed` |
| `result` | JSON | |
| `created_at`, `done_at` | timestamps | |

**`apply_photos`**

| Column | Type |
|---|---|
| `id` | uuid pk |
| `run_id` | fk, cascade, indexed |
| `user_id` | fk |
| `page_n` | int |
| `part` | int |
| `data` | LargeBinary |
| `size` | int |
| `created_at` | timestamp |

**`profile_facts`**

| Column | Type |
|---|---|
| `id` | uuid pk |
| `user_id` | fk, cascade, indexed |
| `question` | text |
| `answer` | text |
| `saved_job_id` | fk, set null |
| `created_at`, `updated_at` | timestamps |

**`resumes`** gets two new columns:
- `is_master` (bool, default false);
- `document_id` (fk generated_documents, set null): the document this PDF is made from.

**Locking:** every change to a run goes through `_locked_run()` (`SELECT … FOR UPDATE` on Postgres), so Claude's tools and Job Catcher's results never overwrite each other's JSON.

## Contracts

### Connector tools (Claude)

| Tool | Does | Returns |
|---|---|---|
| `get_apply_brief(run_id?)` | Starts the run. | Playbook + rules, job, master profile, things told, missing skills, step, next |
| `ask_questions(run_id, questions[{question, why}])` | At most 12. Status → questions. | What to tell the user |
| `save_resume(run_id, content)` | Checks the layout. Saves the doc + PDF résumé and sets the job's résumé. Status → filling. | `resume_id`, `document_id`, next |
| `fill_page(run_id, page_url)` | A Job Catcher fill request. Waits ≤25 s. | Filled, needs you, or no answer |
| `page_done(run_id, page_url, page_title, answers[{q,a,claude?}])` | A photo request. Waits ≤25 s. | Page n, photo taken or missing, blocked Submits |
| `need_help(run_id, kind, what)` | Status → needs_you. | What to tell the user |
| `ready_for_review(run_id, page_url, page_title, answers)` | A last-page photo. Status → review. | Next: `wait_for_you` |
| `wait_for_you(run_id)` | Waits ≤25 s for the thing being waited on. | `{waiting_on, ready, answers?, decision?, note?}` |
| `user_said(run_id?, answers?, decision?, note?)` | Records what the user said in a chat. | The same as `wait_for_you` |
| `finish_apply(run_id, sent, note, page_url?)` | sent → Applied stage + a confirmation photo request. Run ends. | What to tell the user |

### REST `/v1/apply` (the app, plus Job Catcher with its pass)

**The app:**
- `POST /runs {saved_job_id}`: 201 run, or 409 `{open_run_id}`.
- `GET /runs/open`: the open run, short form, or null. Used by the banner.
- `GET /runs?saved_job_id=`: runs for a job, newest first.
- `GET /runs/{id}`: the full run, with photo ids.
- `POST /runs/{id}/answers {answers:[{id, answer?, skipped?}], done}`
- `POST /runs/{id}/help-done`
- `POST /runs/{id}/decision {decision: submit|fix|self, note?}`
- `POST /runs/{id}/sent`: "I submitted it myself", by hand.
- `POST /runs/{id}/stop`
- `GET /photos/{id}`: the image bytes, owner only.

**Job Catcher (pass allowed):**
- `GET /active`: `{run_id, status, guard, hosts, requests:[{id, kind, url, page_n}]}` or `{run_id: null}`.
- `POST /requests/{id}/claim`: 409 if already claimed.
- `POST /requests/{id}/result {ok, reason?, filled?, need?, answers?}`
- `POST /requests/{id}/photo?part=n`: a raw `image/jpeg` body, ≤400 KB, JPEG magic checked, ≤8 parts.
- `POST /runs/{id}/event {kind: blocked_submit|submit_pressed, url}`

### Résumés and facts

- `PUT /v1/ai/resumes/{id}/master`
- `DELETE /v1/ai/resumes/{id}`: refused for the usual résumé and the master.
- `GET /v1/ai/resumes` adds `is_master` and `made_for_job` (from `document_id`).
- `PATCH /v1/ai/documents/{id}` also remakes a linked résumé's PDF.
- `GET /v1/profile-facts`, `PATCH /v1/profile-facts/{id}`, `DELETE /v1/profile-facts/{id}`

## Playbook

`app/apply/playbook.md` (the steps) and `app/apply/rules.md` (locked, always last), with `APPLY_PLAYBOOK_VERSION`. The rules:
- never press the final Submit without the user's OK;
- never make anything up;
- never type or store a password;
- never solve a CAPTCHA;
- self-ID only from saved answers, else "I don't wish to answer";
- one job per run.

## Constitution check

- **Security:**
  - Every route is owner-scoped.
  - Photos are served only to their owner.
  - Uploads are size- and type-checked.
  - No passwords are stored.
  - Pass routes are added to the pass allowlist test.
  - Personal data is never logged: events hold short texts, not answers.
- **Tests first:** service, route, tool, migration, frontend component and extension unit/e2e tests.
- **Simplicity:**
  - JSON columns on one run row, the same as Scout.
  - Requests get their own table only because they need an atomic claim.
- **No AI in the app:** Claude does the writing. The app only stores, checks layout, makes the PDF, and matches words.
