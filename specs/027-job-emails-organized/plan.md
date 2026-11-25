# Implementation Plan: Every email about a job, kept and organized

**Branch**: `027-job-emails-organized` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

> **Status: plan only.** Nothing is built until the owner says go.

## Summary

The Yahoo scan reads every email fine but throws away two kinds of real updates:
- emails for a card that's already at that stage;
- single-company emails mistaken for job alerts.

The fix:
1. Keep every email tied to a saved job (a new `noted` status).
2. Make the job-alert test run after matching and ignore titles inside titles and generic company names.
3. Show each job's emails in sections on its page.
4. List "New emails on your jobs" and "Looked at, not shown" on Email updates.
5. Re-check the last 30 days once.
6. Make the dry-run tool tell the truth.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript/React 19 (app) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, APScheduler; Vite, TanStack Query v5, shadcn/ui |
| **Storage** | Postgres: `detected_events` gains `seen_at` (timestamptz, null) and `skip_reason` (str 30, null). New statuses `noted` and `skipped` (strings, no schema change). One additive migration after `w1f2a3b4c5d7` |
| **Testing** | pytest. The existing email suites (template, match, place, scan) must stay green. New fixtures are anonymized copies of the 10 real shapes. vitest for the sections |
| **Target Platform** | Render, Vercel, phone first |
| **Performance Goals** | Scans no slower; job alerts stored once instead of re-read every scan |
| **Constraints** | No AI; accuracy first (same evidence rules for putting an email on a job); privacy (owner-only, RLS, invented names in tests) |
| **Scale/Scope** | One inbox; about 120 emails a day; ≤ 500 "looked at" rows kept |

All unknowns are resolved in [research.md](research.md).

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Spec, research, data model, contracts, quickstart, tasks; root cause written down |
| II. User-centric | ✅ Nothing lost, sections that read at a glance, phone-first, two-tap recovery |
| III. AI-powered | ✅ No AI: rules, each tested |
| IV. Security & privacy | ✅ Owner-only routes, RLS kept, no real mail in git, re-check never moves cards |
| V. Test-driven | ✅ Regression tests from the real failure shapes first, then the fix |
| VI. Clean architecture | ✅ Pure functions: `card_action` outcome → status, the digest test, the section mapping |
| VII. Simplicity | ✅ Two columns, two status values, no new tables |

**Gates pass. Re-checked after the design: still pass.**

## Project Structure

```text
specs/027-job-emails-organized/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
└── contracts/interfaces.md

backend/
├── alembic/versions/x2a3b4c5d6e8_email_noted.py   # seen_at, skip_reason
├── app/models/detected_event.py                    # STATUS_NOTED, STATUS_SKIPPED
├── app/services/email_scan.py                      # store noted + skipped; digest after matching; recheck mode
├── app/services/email_match.py                     # looks_like_digest: titles inside titles, generic names, clear-match bypass
├── app/services/email_review.py                    # latest_by_job: unseen; mark_seen; list new/looked-at; sweep
├── app/api/v1/email.py                             # job-emails/seen, recheck, new, looked-at
├── app/main.py                                     # daily sweep of old looked-at rows
├── scripts/email_scan_debug.py                     # the real decision, rolled back
└── tests/ (email suites + new fixtures)

frontend/src/
├── lib/emailSections.ts                            # kind → section, summary line (pure)
├── components/email/JobEmails.tsx                  # sections, New, seen
├── components/email/NewOnYourJobs.tsx              # Email updates list
├── components/email/LookedAt.tsx                   # Looked at, not shown + recover
├── components/tracker/* (card dot)
└── routes/EmailUpdatesPage.tsx                     # the two lists + Re-check
```

**PRs:**
- **A, nothing is lost:**
  - `noted` and `skipped` stored;
  - the digest fix;
  - the honest dry run;
  - the re-check (server plus its button).
  - This alone brings back the missed emails, shown in today's flat job list.
- **B, organized:** sections on the job page, New / seen, "New emails on your jobs", "Looked at, not shown" with recovery, and the card dot.

## Risks

| Risk | Handling |
|---|---|
| The digest fix lets real job alerts onto jobs | The clear-match bypass only applies with company-level evidence. A 5-day replay of real board alerts (LinkedIn, Glassdoor, Lensa, Indeed, Snagajob) must stay off every job (SC-002) |
| A noted email lands on the wrong job | Same matching evidence as today's moves. "Not this job" fixes it and is remembered |
| Re-check floods the page | It only adds rows not already stored, never moves cards, and new rows show as one count ("12 emails found") |
| Storing skipped rows grows the table | 30 days, ≤ 500 per account, daily sweep |
| Real mail in tests | Fixtures are hand-anonymized shapes (invented companies and people); a pre-push check greps the diff for the owner's real company names (the existing practice) |

## Complexity Tracking

No violations.
