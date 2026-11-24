# Implementation Plan: New-user onboarding and Job Catcher download

**Branch**: `019-new-user-onboarding` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/019-new-user-onboarding/spec.md`

## Summary

Make the app ready for friends who aren't the owner: no Yahoo, no Claude, no idea what Job Catcher is.

1. **Front door (US1, US2):**
   - A short **Welcome**: hello → résumé (the free AI fills the profile, then you review it) → Job Catcher → optional extras → done.
   - A **Getting started** card whose ticks come from real state.
   - Progress is kept per account; existing users are backfilled as done (R6).
2. **Job Catcher for everyone (US3, US4):**
   - A release workflow publishes a ready-to-load zip to GitHub Releases on every new version. It is hard-gated against non-live URLs (R1, R2).
   - A `/job-catcher` page with a six-step illustrated guide (R11).
   - Version check and "update available" (R3).
   - A pinned extension key so updates keep settings (R5).
   - **Connect with one press**: a backend-brokered device flow that gives Job Catcher **its own revocable pass** (`jcx_`), with a proof that only the Job Catcher in the same Chrome can supply (R4). GitHub sign-ups can use Job Catcher for the first time, and no Supabase secret is needed.
   - Login honours `redirect`; forgot/reset password is added (R7).
3. **Explain everything (US5):**
   - An `InfoBubble` on Base UI Popover (already installed) for hover, click and tap (R8).
   - The text lives in one `help.ts`. The panel gets a small twin.
4. **Fair use (US6):**
   - Postgres counters, plus owner-editable allowances.
   - Spend-before / refund-on-failure, admin exempt.
   - The shared JSearch month keeps a reserve for the owner (R9).
   - "Left today" labels.
5. **Owner view (US7):** setup ticks, Job Catcher version, real `last_active_at` (R10) and usage in the admin user list.

Ships as **3 PRs**, each independently useful:
- **PR A:** sign-in fixes, Connect, release zip, `/job-catcher`, extension hello/update.
- **PR B:** Welcome, checklist, bubbles.
- **PR C:** allowances and the admin view.

## Technical Context

**Language/Version**: Python 3.11 (backend), TypeScript + React 19 (frontend and panel), JavaScript ES2022 (extension background).

**Primary Dependencies**:
- FastAPI, SQLAlchemy 2 async, Alembic, httpx (GitHub API and Supabase admin), slowapi;
- Vite, React Router 7, TanStack Query 5, Tailwind 4, shadcn plus `@base-ui/react` 1.6 Popover (already installed: no new frontend dependency);
- Chrome MV3;
- GitHub Actions (`softprops`-free: the `gh release create` CLI).

**Storage**: Postgres (Supabase). New tables `user_onboarding`, `extension_installs`, `extension_connect_requests`, `usage_counters` and `app_settings`, plus `users.last_active_at`. All have RLS on and cascade on user delete ([data-model.md](data-model.md)).

**Testing**:
- pytest (API + services) and Vitest + Testing Library (frontend).
- Vitest + Playwright MV3 against the fake API (extension).
- Release workflow validated through `workflow_dispatch`.

**Target Platform**:
- Web app on phone and computer.
- Job Catcher on desktop Chrome, Edge and Brave 120+.

**Project Type**: Web app + browser extension + API (monorepo).

**Performance Goals**:
- Onboarding endpoints under 200 ms server time.
- The allowance check adds one upsert per AI or live call.
- Connect: under 5 s from Approve to the panel signed in (2 s poll).

**Constraints**:
- $0/month.
- No real personal data in the repo, screenshots or fixtures.
- Plain words.
- Optional integrations are never required.
- Service-role key only on the server.
- The zip never points anywhere but the live app.

**Scale/Scope**: developer + friends (tens of users).
- About 5 new backend modules and 1 migration.
- About 8 frontend pages/components.
- About 4 panel changes.
- 1 workflow.
- About 60 tests across the stack.

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio-grade quality | ✅ Release automation with a safety gate, device-style auth with written threat notes, documented research |
| II. User-centric ("a first-time user can use it without instructions"; WCAG AA) | ✅ This feature *is* that principle: Welcome, checklist, bubbles. Bubbles are keyboard and screen-reader accessible (Base UI). Phone parity. |
| III. AI degrades gracefully; costs transparent | ✅ The free AI failing or running out never blocks onboarding (manual fallback). "Left today" makes the cost visible. |
| IV. Security & privacy | ✅ Connect: single-use, 5-minute, poll-token-bound, rate-limited, hashed tokens. The service key stays server-only. Redirects are same-origin only. Forgot-password doesn't reveal accounts. Bubbles and screenshots carry no personal data. New tables have RLS + cascade, and export includes them. |
| V. Test-driven | ✅ Each endpoint has integration tests, the flows have e2e, and the release gate has a failing case |
| VI. Clean architecture | ✅ New logic sits in services (`onboarding`, `allowance`, `extension_connect`, `releases`). Routers stay thin. Help text is in one module. |
| VII. Simplicity | ✅ No new frontend dependency (Base UI already there), no Redis (Postgres counters), GitHub Releases rather than new hosting. One justified addition below. |

**Complexity justified**: the auth layer accepts a second credential type, the Job Catcher pass. It is hashed, revocable, idle- and age-limited, capped per account, and refused for account-management actions. This avoids putting the far more powerful Supabase service-role key on the server (R4).

*Re-checked after Phase 1 design: no new violations.*

## Project Structure

### Documentation (this feature)

```text
specs/019-new-user-onboarding/
├── spec.md
├── plan.md            # this file
├── research.md        # R1–R12 decisions
├── data-model.md
├── contracts/
│   ├── api.md
│   └── ui.md
├── quickstart.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/n2c3d4e5f6a8_onboarding_usage_connect.py
├── app/models/{onboarding,extension_install,extension_connect,usage_counter,app_setting}.py
├── app/services/onboarding.py        # derive checklist, patch, backfill helpers
├── app/services/allowance.py         # spend / refund / remaining / exempt, Pacific periods
├── app/services/extension_connect.py # start / approve (proof) / cancel / poll, jcx passes
├── app/services/releases.py          # GitHub latest release, 10-minute cache
├── app/api/v1/onboarding.py          # GET/PATCH /onboarding, GET /usage
├── app/api/v1/extension.py           # latest, hello, connect/*
├── app/api/v1/{ai,jobs,users,admin}.py  # allowance hooks, export, admin columns + allowances
├── app/middleware/auth.py            # last_active_at touch (15-minute throttle)
├── app/mcp_server.py                 # claude_seen_at touch
├── app/services/sources/jsearch.py   # shared monthly counter + reserve
└── tests/api/test_{onboarding,extension_connect,allowance,extension_release}.py

frontend/src/
├── routes/{WelcomePage,JobCatcherPage,ConnectPage,ForgotPasswordPage,ResetPasswordPage}.tsx
├── routes/Login.tsx                  # redirect + Forgot password link
├── components/onboarding/{GettingStarted,ResumeStep,ProfileReview,ExtrasStep,InstallSteps,InstallArt}.tsx
├── components/common/InfoBubble.tsx  # Base UI Popover
├── components/common/AllowanceNote.tsx
├── components/admin/{UserTable,AllowancesCard}.tsx
├── hooks/{useOnboarding,useUsage,useExtensionLatest}.ts
├── lib/help.ts                       # all bubble text
├── lib/safeRedirect.ts
└── router.tsx, components/layout/nav.ts

extension/
├── manifest.json                     # "key" (pinned id), version bump
├── panel/src/views/SignIn.tsx        # Connect first, password second
├── panel/src/lib/help.ts, panel/src/ui/Info.tsx
├── panel/src/views/{Settings,App}.tsx # version + update banner
└── src/background.entry.js           # connect start/poll/verify, hello (hourly), install_id

.github/workflows/job-catcher-release.yml
```

**Structure decision**: the existing monorepo layout. Every addition sits beside its peers.

## Delivery order

1. **PR A: "Anyone can get and connect Job Catcher"** (US3, US4; FR-007–015). This is the biggest unblocker: GitHub sign-ups can't use Job Catcher today. It includes the release workflow and the owner's one-time setup (quickstart prerequisites).
2. **PR B: "Welcome, Getting started, ⓘ"** (US1, US2, US5; FR-001–006, 016–017, 023).
3. **PR C: "Fair use + owner view"** (US6, US7; FR-018–022, 024). It must merge **before** the owner shares the app link widely.

Each PR goes through: branch → tests → build → independent review → green CI → squash-merge → rebuild the extension on main.

## Risks

- **A pass in chrome.storage.local** is as sensitive as a refresh token was. It is limited by idle and age caps, revocable from the app, and sign-out revokes it server-side.
- **The pinned key changes the extension ID once.** The owner and laptop must re-add Job Catcher one time; it is announced in the PR and on `/job-catcher`. Existing chrome.storage settings on the old ID are lost once: Super autofill defaults on, and taught boxes and answers live server-side, so little is lost.
- **GitHub API unreachable.** The page still links the `latest/download` URL; only the version text and update note are missing.
