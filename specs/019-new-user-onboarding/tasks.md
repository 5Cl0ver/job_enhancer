# Tasks: 019 New-user onboarding, parts B and C

**Scope:**
- Part A (Connect, download, sign-in fixes) is merged as PR #38.
- This file covers **PR B** (US1, US2, US5) and **PR C** (US6, US7).
- No AI anywhere (research R13).
- File paths are relative to the repo root.
- Tests are requested by the constitution (V. Test-driven): within each story, tests come first.

## PR B: Welcome, Getting started, ⓘ bubbles (branch `019b-welcome-checklist-bubbles`)

### Phase 1: Setup
- [X] T001 Migration `q5f6a7b8c9d1_user_onboarding.py` in `backend/alembic/versions/`:
  - Create table `user_onboarding`: user_id PK and FK users with ON DELETE CASCADE; welcome_step smallint, default 0; welcome_done_at; profile_reviewed_at; checklist_hidden bool, default false; claude_seen_at; created_at; updated_at. RLS enabled.
  - Backfill one row per existing user with welcome_step=4 and welcome_done_at=now().

### Phase 2: Foundational
- [X] T002 [P] Model `UserOnboarding` in `backend/app/models/onboarding.py`, registered in `backend/app/models/__init__.py`.
- [X] T003 [P] `settings.ai_in_profile_fill: bool = False` in `backend/app/config.py`.

### Phase 3: US1, a Welcome that sets a newcomer up (P1)

**Independent test:** a new account sees `/welcome`. Uploading a sample résumé fills name, phone, city and links with no AI call. "Looks right" marks the profile reviewed. Skip lands in the app, and the Welcome doesn't come back.

- [X] T004 [P] [US1] Tests in `backend/tests/services/test_profile_extract.py`. The built-in contact reader must find:
  - name from the first line (and refuse lines with digits, @ or a URL);
  - email, phone, "City, ST", LinkedIn and GitHub.
  
  It must also make **no** AI call when `ai_in_profile_fill` is false.
- [X] T005 [US1] Built-in contact reader `extract_contact_heuristics` in `backend/app/services/profile_extract.py`: first_name and last_name, email, city and state, existing links. `extract_profile` skips `ai_service._invoke` unless `settings.ai_in_profile_fill`.
- [X] T006 [P] [US1] Tests in `backend/tests/api/test_onboarding.py`:
  - GET creates the row for a new user with done=false.
  - PATCH sets step, done, undone, profile_reviewed and checklist_hidden.
  - Items derive from real state: résumé, profile, job_catcher via extension_installs, first_job, email, claude.
  - required_done and required_total.
  - A pre-existing user with a non-empty profile counts as profile done.
  - A pass is refused.
  - The export includes onboarding.
- [X] T007 [US1] Service `backend/app/services/onboarding.py`: `get_or_create(db, user)`, `state(db, user)` (derived ticks), `patch(db, user, changes)`, `touch_claude(db, user_id)` (hourly throttle).
- [X] T008 [US1] Routes `GET` and `PATCH /v1/onboarding` (session only) in `backend/app/api/v1/onboarding.py`. Mount them in `backend/app/api/v1/router.py` and add schemas in `backend/app/schemas/onboarding.py`.
- [X] T009 [US1] Set `claude_seen_at` from `_session_user` in `backend/app/mcp_server.py`, best effort, never failing a tool call. Test in `backend/tests/test_mcp_server.py`.
- [X] T010 [US1] Export `onboarding` in `backend/app/api/v1/users.py` `export_data`.
- [X] T011 [P] [US1] Hook `frontend/src/hooks/useOnboarding.ts`: `useOnboarding(poll?)` and `useUpdateOnboarding()`.
- [X] T012 [US1] `WelcomePage` at `/welcome` (`frontend/src/routes/WelcomePage.tsx`):
  - Steps: Hello, résumé, Job Catcher, extras, done.
  - Dots, Skip, Back, and `?step=`.
  - Progress saved through PATCH, and the step survives a reload.
  - Phone layout.
  - Components in `frontend/src/components/onboarding/`:
    - `ResumeStep.tsx`: upload, then fill-from-résumé, then a compact review (first, last, phone, city, state, LinkedIn), plus "We found N jobs and M schools · Check them". The failure path shows an empty form. **Looks right** sets profile_reviewed.
    - `JobCatcherStep.tsx`: computer gets `/job-catcher` in a new tab; phone gets Share and Copy (reuse `/job-catcher`'s share card). Live "Connected ✓" via 5-second polling.
    - `ExtrasStep.tsx`: Email and Claude cards with **Set up** and **Not now**.
- [X] T013 [US1] Auto-open: `DashboardLayout` redirects to `/welcome` once per session when `welcome.done` is false (never from `/welcome` itself). Register the route in `frontend/src/router.tsx`, outside the sidebar frame but inside RequireAuth.
- [X] T014 [US1] Tests in `frontend/tests/components/Onboarding.test.tsx`: steps and dots, Skip sets done, Back, the review saves the profile and profile_reviewed, the phone variant of the Job Catcher step.
- [X] T015 [US1] Settings → Claude section: add the connector address and steps (plain words), so the "Set up Claude" link lands somewhere useful (`frontend/src/routes/SettingsPage.tsx`).

### Phase 4: US2, the Getting started checklist (P1)

**Independent test:** a new account that skipped everything sees "0 of 4". Uploading a résumé ticks it. "I'm all set" hides the card on every device; the Settings switch brings it back.

- [X] T016 [US2] `GettingStarted.tsx` in `frontend/src/components/onboarding/`:
  - Progress bar, the next item highlighted, and items linking to their exact places.
  - Optional items labelled.
  - A ⋯ menu with **I'm all set** and **Open the welcome again**.
  - Hidden when checklist_hidden is set or everything required is done.
- [X] T017 [US2] Place the card at the top of `frontend/src/routes/SearchPage.tsx` and `frontend/src/routes/MyJobsPage.tsx`.
- [X] T018 [US2] Settings → Appearance: a **Show Getting started** switch and a **Show the welcome again** button (`frontend/src/components/settings/AppearanceCard.tsx`).
- [X] T019 [US2] Tests in `frontend/tests/components/Onboarding.test.tsx`: ticks, progress, hide, hidden when done, optional items not counted.

### Phase 5: US5, ⓘ bubbles (P2)

**Independent test:** every listed ⓘ opens on hover or click (computer) and on tap (phone), closes on Esc or an outside press, and shows What, Why and Needs in plain words.

- [X] T020 [P] [US5] `frontend/src/lib/help.ts`: bubble text for matches, email, aiApply, autofill, analytics, jobCatcher, scout, stages, settingsClaude, settingsEmail, settingsExport. Each has `{title, what, why, needs?, more?}`.
- [X] T021 [P] [US5] `InfoBubble.tsx` on Base UI Popover in `frontend/src/components/common/`: `openOnHover delay=150`, click and tap, collision avoidance, max-w 280px, `aria-label="About {title}"`.
- [X] T022 [US5] Place bubbles beside:
  - the page titles of `MatchesPage`, `EmailUpdatesPage`, `AiApplyPage`, `AutofillMemoryPage`, `AnalyticsPage` and `JobCatcherPage`;
  - the Claude Scout tab (`frontend/src/components/scout/ScoutPanel.tsx`);
  - the pipeline stages header (`frontend/src/components/tracker/KanbanBoard.tsx`);
  - the Settings sections Claude, Email and Export (`SettingsPage.tsx` `Section` gets a `help` prop).
  
  On phones the page titles are hidden, so the phone top bar also shows the page's bubble (`frontend/src/components/layout/PhoneNav.tsx`).
- [X] T023 [US5] Tests in `frontend/tests/components/Onboarding.test.tsx`: opens on click, Esc closes, accessible name, renders the three parts; and every `help.ts` entry has non-empty what and why with no jargon words.
- [X] T024 [P] [US5] Job Catcher panel: an `Info` component in `extension/panel/src/ui/index.tsx` (a button with a popover, Esc and outside press to close) plus `extension/panel/src/lib/help.ts`. Bubbles on Super autofill (`Apply.tsx`), Point at a box (`ThisPage.tsx` or `Trouble.tsx`) and Write for this job (`Write.tsx`).
- [X] T025 [US5] Extension e2e/unit: the panel's ⓘ opens and closes (`extension/e2e/panel.spec.js`).

### Phase 6: Polish (PR B)
- [X] T026 Update `MANIFEST.md`s (backend models, services, frontend routes, components, hooks, lib). Bump the extension version to 0.38.0 (`manifest.json`, `package.json`, release notes).
- [X] T027 All suites pass: backend pytest + ruff; frontend vitest + `npm run build` + lint; extension check + unit + Playwright. Then PR, independent review (code + security), fixes, green CI, squash-merge, and the live migration check.

## PR C: Fair use + owner view (branch `019c-fair-use-admin`)

### Phase 7: Setup
- [X] T028 Migration `r6a7b8c9d0e2_fair_use.py`:
  - Create table `usage_counters`: id, user_id nullable FK with cascade, kind, period, count; unique (user_id, kind, period) with `postgresql_nulls_not_distinct=True`; RLS.
  - Create table `app_settings` (key PK, value JSON, updated_at; RLS).
  - Add `users.last_active_at`, backfilled from updated_at.
- [X] T029 [P] Models `UsageCounter` and `AppSetting` in `backend/app/models/usage.py`; `User.last_active_at` in `backend/app/models/user.py`.

### Phase 8: US6, fair use of the shared services (P2)

**Independent test:** with live_search set to 1, a normal user's second live search falls back to the pool with a note and nothing spent. AI kinds return 429 ALLOWANCE when over. The admin is never blocked. The JSearch reserve keeps the last 40 for the owner.

- [X] T030 [P] [US6] Tests in `backend/tests/services/test_allowance.py`:
  - spend and remaining; at the limit, raises and spends nothing;
  - refund never goes below 0;
  - admin exempt (counted, not blocked);
  - Pacific day rollover;
  - the jsearch reserve;
  - settings fallback and validation.
- [X] T031 [US6] Service `backend/app/services/allowance.py`:
  - `DEFAULTS`, `limits(db)`, `period_for(kind, now)`, `resets_at(now)`;
  - `spend(db, user, kind)` (a conditional upsert-increment that refuses at the limit), `refund`, `usage(db, user)`;
  - `jsearch_allowed(db, user)` and `spend_jsearch(db)`;
  - `AllowanceExceeded`, with an exception handler giving 429 `{detail:{code:"ALLOWANCE",…}}`.
- [X] T032 [US6] Hook the services up:
  - `/ai/generate` (ai_document);
  - `/ai/autofill-map` (ai_autofill);
  - `/ai/work-history` and `from-resume`, **only when the AI runs** (ai_read);
  - refund on failure (`backend/app/api/v1/ai.py`, `backend/app/api/v1/users.py`);
  - live search (refresh, or an empty pool) spends `live_search`. Over the allowance → pool only, plus `live:false` and a `note` (`backend/app/api/v1/jobs.py`, `backend/app/services/job_search.py`, `backend/app/schemas/job.py`);
  - JSearch counted per request, and skipped for non-admins past cap−reserve.
- [X] T033 [US6] `GET /v1/usage` (session only) in `backend/app/api/v1/usage.py`. Tests in `backend/tests/api/test_allowance_api.py`, including the 429 shape and the search fallback.
- [X] T034 [US6] Frontend:
  - `useUsage` hook;
  - `AllowanceNote` ("N of M left today ⓘ", shown only for kinds that are on);
  - the 429 message through `readableError` (it reads `detail.message`);
  - the search note under results when `live:false`;
  - files: `frontend/src/hooks/useUsage.ts`, `frontend/src/components/common/AllowanceNote.tsx`, `frontend/src/lib/api.ts`, `frontend/src/components/jobs/SearchResults.tsx`.

### Phase 9: US7, the owner view (P3)

**Independent test:** the admin user list shows each user's setup ticks, Job Catcher version (amber if outdated), last active, and use today and this month. A non-admin gets 403.

- [X] T035 [US7] `last_active_at` touched in `_resolve_user` when it is older than 15 minutes (`backend/app/middleware/auth.py`). Admin stats active counts use it (`backend/app/services/admin_service.py`).
- [X] T036 [US7] Admin endpoints:
  - `GET /admin/users` adds `last_active_at`, `onboarding` ticks, `job_catcher {version, last_seen_at, outdated}`, `usage_today` and `usage_month` (an `AdminUserRow` schema);
  - `GET` and `PUT /admin/allowances`, validated;
  - files: `backend/app/api/v1/admin.py`, `backend/app/services/admin_service.py`, `backend/app/schemas/user.py`;
  - tests in `backend/tests/api/test_admin.py`.
- [X] T037 [US7] Frontend: the `UserTable` columns (setup ticks with titles, version, last active, AI and searches today) and an `AllowancesCard` with number inputs and Save. Files: `frontend/src/components/admin/{UserTable,AllowancesCard}.tsx`, `frontend/src/hooks/useAdmin.ts`, `frontend/src/routes/AdminPage.tsx`. Include tests.
- [X] T038 [US7] The export includes `usage` (the last 90 days); the purge job deletes daily counters older than 400 days (`backend/app/api/v1/users.py`, `backend/app/main.py`).

### Phase 10: Polish (PR C)
- [X] T039 Update the MANIFESTs and docs. All suites; PR; independent review (code + security); fixes; green CI; squash-merge; live migration and endpoint check.

## Dependencies

- T001 → T002 → US1 backend (T004–T010) → US1 frontend (T011–T015) → US2 (T016–T019, needs `/onboarding`).
- US5 (T020–T025) is independent of US1 and US2.
- PR C starts after PR B merges (its migration follows `q5f6a7b8c9d1`).
- US6 → US7, because the admin usage columns read the counters.

## Parallel examples

- PR B: T004 and T006 (backend tests) alongside T020 and T021 (help text and InfoBubble) and T024 (panel Info).
- PR C: T030 (allowance tests) alongside T035 (last_active touch).

## Implementation strategy

PR B first: it's the front door, and US1 plus US2 are the MVP. PR C must merge before the owner shares the app link widely (plan.md delivery order).
