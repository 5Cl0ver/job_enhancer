# Routes Manifest (`frontend/src/routes/`)

React Router **page components** (the app's screens), wired up in
[`src/router.tsx`](../router.tsx). Feature-level status lives in
[docs/FEATURES.md](../../../docs/FEATURES.md).

| File | Route | Purpose | Uses |
|---|---|---|---|
| `DashboardLayout.tsx` | `/` (layout) | The app frame: desktop sidebar (icons, Email count, the owner's Add a bug or idea and new-bug count on Admin), or on a phone a top bar + bottom tab bar (`components/layout/PhoneNav`); `<Outlet/>`; the Job Catcher update banner (spec 034); wraps children in `RequireAuth`. `/` opens My Jobs on a phone, Find Jobs on a computer | `useAttention`, `useProfile` |
| `RequireAuth.tsx` | (guard) | Redirect to `/login` if no Supabase session | `lib/supabase` |
| `Login.tsx` | `/login` | Email/password + GitHub sign in/up | `lib/supabase` |
| `AuthCallback.tsx` | `/auth/callback` | OAuth redirect landing → session → `/search` | `lib/supabase` |
| `SearchPage.tsx` | `/search` | "Find Jobs": tabs Job boards (search bar + filters + results) and Claude Scout (`?tab=scout`) | `hooks/useJobs`, `components/jobs`, `components/scout` |
| `SavedPage.tsx` | `/saved` | Saved jobs + collections sidebar | `hooks/useSavedJobs`, `components/jobs` |
| `TrackerPage.tsx` | `/tracker` | Kanban board wrapper | `components/tracker` |
| `MatchesPage.tsx` | `/matches` | New-matches feed (saved searches) | `hooks/useSavedSearches` |
| `AnalyticsPage.tsx` | `/analytics` | Personal stats + chart | `hooks/useAnalytics`, `components/analytics` |
| `AiApplyPage.tsx` | `/ai-apply` | AI resume/cover letter (final phase) | `hooks/useAI`, `components/ai` |
| `SettingsPage.tsx` | `/settings` | Data export + account delete; a link to Sites to skip (Claude) | `hooks/useProfile`, `lib/api` |
| `AdminPage.tsx` | `/admin` | Owner-only dashboard (role-guarded), with the way into Bugs & ideas and its new-bug count | `hooks/useAdmin`, `components/admin` |
| `AdminBugsPage.tsx` | `/admin/bugs?id=` | Bugs & ideas (spec 032), owner only: the list, and the open report as a side panel (computer) or a sheet (phone) | `hooks/useBugReports`, `components/bugs` |
| `Placeholder.tsx` | — | Dev stub for un-ported pages (none currently) | — |
| `JobCatcherPage.tsx` | `/job-catcher` | Get Job Catcher: download, 6-step guide, version, what's new in the latest release (spec 034), how to update, connected computers (spec 019) | `hooks/useJobCatcher`, `components/jobcatcher` |
| `ConnectPage.tsx` | `/connect?code=` | Approve a Job Catcher with one press; needs the proof from the Job Catcher in this Chrome (spec 019) | `lib/jobCatcher`, `hooks/useJobCatcher` |
| `ForgotPasswordPage.tsx` | `/forgot-password` | Email a reset link; always the same neutral message | `lib/supabase/client` |
| `ResetPasswordPage.tsx` | `/reset-password` | Choose a new password (8+ characters, twice) | `lib/supabase/client`, `lib/recovery` |
| `WelcomePage.tsx` | `/welcome` | The Welcome (spec 019): hello → résumé (read with no AI, then checked) → Job Catcher → optional extras → done; Skip on every step; `?step=` | `hooks/useOnboarding`, `components/onboarding/*` |
| `ApplyRunPage.tsx` | `/apply/:runId` | One application with Claude (spec 022), live: steps, start line, Claude needs you, questions (one checklist, spec 030), résumé for this job, its cover letter (spec 031), pages with photos, your review, sent, problems Claude ran into | `hooks/useApply`, `components/apply/*` |

**How this folder connects:** pages compose `components/*` for UI, call
`hooks/*` (TanStack Query) for data → which hit `lib/api.ts` → FastAPI `/v1`.
Auth/session comes from `lib/supabase/client.ts`.
