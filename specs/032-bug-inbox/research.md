# Research: Bug inbox (032)

Findings from reading the code (2026-11-25), and the decisions they lead to.

## R1. Where screenshots live

- **Decision:** store them as bytes in a `bug_report_shots` table, the way `apply_photos` and `resumes.file_data` already do. The browser shrinks each image to a JPEG of at most 1200 px wide and about 400 KB before upload, reusing Job Catcher's `shrink()` approach. The server refuses anything over 1 MB, and anything that isn't a JPEG, PNG or WebP (checked by magic bytes).
- **Rationale:** the app has no Supabase Storage code at all, so adding a bucket, signed URLs and a second credential is new complexity for an owner-only feature. A few hundred KB per report is fine at this scale.
- **Alternatives:** Supabase Storage (rejected: new moving part, nothing reuses it); data URLs in a JSON column (rejected: bloats every list query).

## R2. One table of reports, events for everything that happens to them

- **Decision:**
  - `bug_reports` holds the current state of each report.
  - `bug_report_events` holds an append-only log: `seen` (an occurrence), `status`, `edit`, `note`, `merge`, `split`, `link`, `unlink`. History, notes and occurrences all come from this one log.
  - `bug_report_links` holds "related to" pairs.
- **Rationale:** a single log gives history, notes and recent occurrences without four tables. Pruning keeps only the latest 20 `seen` events per report, while `count` keeps the true total.
- **Alternatives:** separate notes, occurrences and history tables (more joins, same information); JSON arrays on the report (no ordering or pruning, and a lock on every write).

## R3. Fingerprints and merging (no AI)

- **Decision:** `fingerprint = sha1(section | kind | place)[:16]`, where `place` is normalized:
  - **App routes:** IDs and UUIDs become `:id` (`/jobs/3f2…` becomes `/jobs/:id`).
  - **Sites:** host plus path, with IDs stripped.
  - **Server errors:** method, the route template from `request.scope["route"].path`, and the exception class.
  - **Run problems:** kind, host, and the first 60 characters of the cleaned text.
- **Merging:**
  - Caught reports and run problems with an equal fingerprint merge automatically.
  - Reports from the owner and their AI get suggestions: open reports in the same section whose title scores 80 or higher with `rapidfuzz.fuzz.token_set_ratio`. `rapidfuzz` is already a dependency, used for job dedup.
- **Rationale:** deterministic, testable, free. The owner's own words vary too much for exact matching, so they get suggestions rather than silent merges.

## R4. "Came back"

- **Decision:** when a `seen` event lands on a report whose status is `fixed`, the report moves to `new`. It records `came_back_at`, keeps `fixed_in`, and its history entry says "Came back after the {fixed_in} fix". `won't fix` reports only count up and don't reopen.

## R5. Priority

- **Decision:** sort in SQL by `pinned desc, severity rank (blocker 3, major 2, minor 1, idea 0) desc, came_back_at is not null desc, count desc, last_seen desc`. Computed at read time, with no stored score.

## R6. Catching errors (spec FR-005)

| Source | Today | Decision |
|---|---|---|
| Server errors | `unhandled_exception_handler` only logs | Also call `bug_reports.catch_server_error(request, exc)` in its own short session, wrapped in `try/except`. A failure there is only logged and never reported again. Users stay anonymous. |
| App crashes | No error boundary or `window.onerror` | Add a route `errorElement` (a friendly "Something went wrong, reload" page) plus `window.onerror` and `unhandledrejection` listeners. They post to `POST /v1/bugs/caught`. A module flag stops reporting while a report is being sent, and the same message is sent at most once a minute. |
| Job Catcher | Failures shown in the panel; `console.warn` | `background.entry.js` posts real failures to `/v1/bugs/caught` with the Job Catcher pass: save errors other than "already saved" or "not signed in", and résumé `failed`. Plus the site host and path and the version. |
| Email checks | `scan_inbox` sets `status=error` and `last_error` | On the 502 and 400 failure paths, record a caught report with provider and reason only, never the address or mail. |
| Scout | No error status; refusals logged as `ScoutRunEvent(ok=False)` | Record a caught report when `scout_log.record` stores `ok=False`, using the tool name and the refusal category. |
| Health | Computed live only when Admin is open | A new 15-minute scheduler job runs `check_service_health`. A service turning `down` (when its last recorded state wasn't down) records one caught report per outage. Recovery adds a history line. |

Rate limit: `/v1/bugs/caught` is limited to 20 per minute per user (slowapi). Globally, at most 30 **new** caught reports an hour; past that, one "Too many errors, N more not kept" report counts the rest. Merges into existing reports always count.

## R7. Versions

- **App:**
  - The frontend reads `VERCEL_GIT_COMMIT_SHA` at build time through a Vite `define` (`__APP_VERSION__`, 7 characters, `"dev"` locally).
  - The backend reads `RENDER_GIT_COMMIT` (Render sets it) and shows it in reports and the health endpoint.
- **Job Catcher:** from `apply_runs.job_catcher_status` (the newest install) for app reports, and from the manifest for Job Catcher's own reports.

## R8. Owner checks

- **REST:** `AdminUser` (`require_admin`). Job Catcher's owner reporting needs the pass, so a new dependency `require_admin_or_pass` checks the role of the user behind the pass.
- **Connector:** a helper `_owner_only(user)` raises `ValueError("Only the app's owner can use this.")` when `user.role != "admin"`. It is the first line of each new tool.
- **Job Catcher:** `/v1/extension/hello` (or `authStatus`) also returns `is_owner`, so the panel shows the report link only to the owner. The server checks again on every report.

## R9. Naming

"Inbox" already means the user's messages in an apply run (`apply_runs.with_inbox`). So in code the feature is **`bug_reports`**, and in the UI it's **"Bugs & ideas"**.

## R10. Run problems (spec 030)

- **Decision:**
  - `apply_problems.add` stays as it is. The run page still reads `run.problems`.
  - `apply_runs.report_problem` also calls `bug_reports.from_run_problem(...)`, with section **Apply with Claude**, or **Job Catcher** for kinds `job_catcher` and `resume`, linked to `run_id` and `job_id`.
  - A data migration brings past problems in once (open → new, fixed → fixed, ignored → won't fix).
  - The old `GET`/`PATCH /v1/admin/apply-problems` routes, `admin_list`, `set_status` and `BugReportsCard` are removed, with no dead code left.
  - `lib/bugReport.ts` (`fenced`, `contextLine`, `DATA_NOTE`) is reused for the new copy.

## R11. Seeds

- **Decision:** a data migration inserts the 5 starting entries with a `seed_key` (unique). Rerunning never duplicates them, and deleting one doesn't bring it back. Their text is product wording only, with no personal data, since the repo is public.

## R12. Attention count

- **Decision:** `GET /v1/attention` adds `bugs_new` (new bugs only, not ideas) for an admin, and 0 for everyone else. It shows as a `CountBadge` on Admin in the sidebar and in the phone's More sheet.
