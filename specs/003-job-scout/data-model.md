# Data Model: Job Scout

All tables carry `user_id` (FK users, cascade delete) and are covered by the
existing RLS-on-everything setup. Timestamps are timezone-aware.

## resume_tracks

| field | type | notes |
|---|---|---|
| id | uuid pk | |
| name | varchar(60) | unique per user ("IT Admin", "Business Analyst") |
| target_titles | jsonb list[str] | 1–15 titles |
| key_skills | jsonb list[str] | used in the fit rubric |
| skip_rules | jsonb | `{degree_only: bool, max_years: int?, exclude: [str]}` |
| min_pay | int? | yearly USD |
| resume_id | uuid? FK resumes (set null) | the resume to apply with |
| notes | text? | free text for the agent ("emphasise automation work") |
| sort_order | int | |
| created_at / updated_at | timestamptz | |

Max 8 per user (service-level check).

## scout_missions

A saved, reusable setup.

| field | type | notes |
|---|---|---|
| id | uuid pk | |
| name | varchar(80) | "LinkedIn · IT Admin · 5 this week" (auto, editable) |
| source | enum: linkedin, indeed, ziprecruiter, glassdoor, local_companies | |
| track_id | uuid FK resume_tracks (cascade) | |
| job_count | int 1–15 | default 5 |
| posted_within_days | int: 1, 3, 7, 14, 30 | |
| min_pay | int? | defaults to the track's |
| location_rule | jsonb | `{zone: [cities], remote: "any"|"local_company_only"|"none"}` |
| min_fit | int 0–10 | default 6 |
| extra_instructions | text? | ≤ 1000 chars |
| last_run_at | timestamptz? | |

## scout_runs

| field | type | notes |
|---|---|---|
| id | uuid pk | short code shown in the prompt |
| mission_id | uuid FK scout_missions (set null) | |
| criteria | jsonb | snapshot of the mission at launch (missions can change later) |
| playbook_version | varchar(20) | which instructions the brief served |
| status | enum: pending → running → done \| stopped | `running` on first brief fetch |
| started_at / finished_at | timestamptz? | |
| summary | text? | agent's end note ("LinkedIn showed a CAPTCHA after 3") |
| counts | jsonb | `{saved, below_bar, duplicates, companies_checked}` |

Transitions: pending →(get_scout_brief) running →(finish_scout_run) done; any
→ stopped by the user. A `done` run rejects further reports.

## scout_findings

Every job any run reported — the dedupe memory.

| field | type | notes |
|---|---|---|
| id | uuid pk | |
| run_id | uuid FK scout_runs (cascade) | |
| track_id | uuid? FK resume_tracks (set null) | |
| saved_job_id | uuid? FK saved_jobs (set null) | null when below bar / duplicate |
| company / title | varchar | as reported |
| company_key / title_key | varchar | normalised (research R3); index (user_id, company_key, title_key) |
| url_key | varchar? | canonical posting URL; index (user_id, url_key) |
| source | enum (as missions) | where it was found |
| fit_score | smallint 0–10 | |
| why_fit / gaps | text | |
| posted_on | date? | null = "not listed" |
| outcome | enum: saved, below_bar, duplicate, rejected_link, dismissed | |
| created_at | timestamptz | |

`dismissed` is set when the user says "Not for me"; the finding stays so the job
never comes back.

## scout_companies

The local company log.

| field | type | notes |
|---|---|---|
| id | uuid pk | |
| name / name_key | varchar | unique (user_id, name_key) |
| homepage / careers_url | varchar? | |
| ats | enum: workday, greenhouse, lever, ashby, workable, bamboohr, breezy, icims, ukg, paylocity, adp, jobvite, dayforce, oracle, other, unknown | |
| employer_type | varchar? | credit union, law firm, manufacturer… |
| city | varchar? | |
| last_checked_at | timestamptz? | |
| last_result | enum: fit_found, no_fit, no_openings, unreachable | |
| hot | bool | true once it ever had a saved job |
| blocked | bool | user says never suggest |
| checks | int | |

## Changes to existing tables

- `saved_jobs.track_id` uuid? FK resume_tracks (set null) — which resume to
  apply with; set by scout, editable on the job page.
- `saved_jobs.scout_finding_id` uuid? — back-link for the "found by Scout" badge
  and fit score on the job page.

One additive Alembic migration per delivery slice (slice 1: `resume_tracks` +
`saved_jobs.track_id`, revision `f7a8b9c0d1e3`); each downgrade drops what it
added.
