# Data model: Bug inbox (032)

The migration comes after `z4c5d6e7f8a0` (031). It's additive, uses `batch_alter_table` where needed, and also runs on SQLite in tests.

## bug_reports

| Column | Type | Notes |
|---|---|---|
| id | UUID pk | |
| type | text | `bug` or `idea` |
| title | text ≤ 140 | required; scrubbed |
| section | text | `app`, `job_catcher`, `email`, `scout`, `apply`, `other` |
| kind | text ≤ 40 | for example `server_error`, `crash`, `save_failed`, `resume_failed`, `email_check`, `scout_refused`, `service_down`, `fill`, `tab`, `manual` |
| place | text ≤ 300 | normalized where (route, host and path, or method and route); never a query string |
| box | text ≤ 200 | the label on the page, if any |
| steps | JSON list[str] | ≤ 12 lines, each ≤ 300; scrubbed |
| actual | text ≤ 2000 | what happened, or the idea text; scrubbed |
| expected | text ≤ 1000 | bugs only; scrubbed |
| severity | text null | `blocker`, `major`, `minor`; null for ideas |
| confidence | text | `sure` or `not_sure`, default `sure` |
| source | text | `owner`, `owner_ai`, `run`, `caught` |
| status | text | bugs: `new`, `confirmed`, `working`, `fixed`, `wont_fix`. Ideas: `new`, `planned`, `done`, `no` |
| needs_check | bool | true when Claude marked it fixed and the owner hasn't confirmed |
| fixed_in | text ≤ 60 null | for example "Job Catcher 0.45.0" or "PR #70" |
| came_back_at | timestamptz null | set when a fixed report is seen again |
| pinned | bool | default false |
| fingerprint | text(16) null, indexed | for auto-merging (research R3) |
| count | int | starts at 1 |
| first_seen, last_seen | timestamptz | |
| context | JSON | `{device, browser, theme, app_version, api_version, job_catcher}`, filled automatically |
| run_id | UUID null, FK apply_runs ON DELETE SET NULL | |
| job_id | UUID null, FK saved_jobs ON DELETE SET NULL | |
| seed_key | text null, unique | starting entries only |
| merged_into_id | UUID null, FK bug_reports | a report merged away is hidden from lists |
| created_at, updated_at | timestamptz | |

Indexes: `(status, type)`, `(section)`, `fingerprint`, `last_seen`.

**No user column.** Caught reports never say who hit them (spec FR-003). `source` tells owner from AI from caught.

## bug_report_events

| Column | Type | Notes |
|---|---|---|
| id | UUID pk | |
| report_id | UUID FK bug_reports ON DELETE CASCADE, indexed | |
| kind | text | `seen`, `status`, `edit`, `note`, `merge`, `split`, `link`, `unlink` |
| by | text | `owner`, `claude`, `app` |
| at | timestamptz | |
| data | JSON | `seen`: `{place, context}`. `status`: `{from, to, fixed_in?}`. `edit`: `{field, from, to}`. `note`: `{text}`. `merge`: `{other_id, snapshot}`, the merged report's fields, so a split can restore it |

Pruning: on each `seen`, delete `seen` events for that report beyond the newest 20.

## bug_report_links

`(a_id, b_id)`, both FK bug_reports ON DELETE CASCADE, stored with `a_id < b_id`, unique pair.

## bug_report_shots

| Column | Type | Notes |
|---|---|---|
| id | UUID pk | |
| report_id | UUID FK ON DELETE CASCADE, indexed | |
| mime | text | `image/jpeg`, `image/png`, `image/webp` |
| size | int | ≤ 1,000,000 |
| data | LargeBinary | deferred in every list query |
| created_at | timestamptz | |

At most 3 shots per report.

## State rules

- **Bug:** `new` → `confirmed` → `working` → `fixed`, and any status → `wont_fix`. The owner can set any status at any time; there is no forced order. "Open" means `new`, `confirmed` or `working`.
- **Idea:** `new` → `planned` → `done`, and any status → `no`.
- **Switching type** maps the status: bug → idea gives `new`; idea → bug gives `new` with severity `major`.
- **Claude marks fixed:** status `fixed`, `needs_check = true`. The owner's **Looks fixed** clears it; **Reopen** sets `new`.
- **Seen while fixed** (R4): status `new`, `came_back_at = now`, `needs_check = false`.
- **Merge** B into A: A's `count` goes up by B's count, `first_seen` takes the earlier of the two, and B gets `merged_into_id = A`. A gets a `merge` event holding B's snapshot. **Split** restores B from the snapshot, clears `merged_into_id`, and takes B's count back off A.

## Validation (every source)

- Text goes through `apply_problems.scrub`-style removal (secrets, codes, emails, phones, cards, SSNs, blobs). It's generalized to take a length cap per field (`scrub(text, cap)`), and the 500 default stays for run problems.
- Unknown `section`, `kind`, `severity` or `status` values are refused (422) on REST and the connector; caught reports fall back to `other`.
- Places drop the query and fragment (`page_of`).
