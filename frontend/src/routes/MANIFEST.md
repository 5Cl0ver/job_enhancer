# Routes Manifest (`frontend/src/routes/`)

React Router **page components** (the app's screens), wired up in
[`src/router.tsx`](../router.tsx). Feature-level status lives in
[docs/FEATURES.md](../../../docs/FEATURES.md).

| File | Route | Purpose | Uses |
|---|---|---|---|
| `DashboardLayout.tsx` | `/` (layout) | The app frame: desktop sidebar (icons, Email count), or on a phone a top bar + bottom tab bar (`components/layout/PhoneNav`); `<Outlet/>`; wraps children in `RequireAuth`. `/` opens My Jobs on a phone, Find Jobs on a computer | `useAttention`, `useProfile` |
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
| `AdminPage.tsx` | `/admin` | Owner-only dashboard (role-guarded) | `hooks/useAdmin`, `components/admin` |
| `Placeholder.tsx` | — | Dev stub for un-ported pages (none currently) | — |
| `JobCatcherPage.tsx` | `/job-catcher` | Get Job Catcher: download, 6-step guide, version and update note, connected computers (spec 019) | `hooks/useJobCatcher`, `components/jobcatcher` |
| `ConnectPage.tsx` | `/connect?code=` | Approve a Job Catcher with one press; needs the proof from the Job Catcher in this Chrome (spec 019) | `lib/jobCatcher`, `hooks/useJobCatcher` |
| `ForgotPasswordPage.tsx` | `/forgot-password` | Email a reset link; always the same neutral message | `lib/supabase/client` |
| `ResetPasswordPage.tsx` | `/reset-password` | Choose a new password (8+ characters, twice) | `lib/supabase/client`, `lib/recovery` |
| `WelcomePage.tsx` | `/welcome` | The Welcome (spec 019): hello → résumé (read with no AI, then checked) → Job Catcher → optional extras → done; Skip on every step; `?step=` | `hooks/useOnboarding`, `components/onboarding/*` |
| `ApplyRunPage.tsx` | `/apply/:runId` | One application with Claude (spec 022), live: steps, start line, Claude needs you, questions, résumé for this job, pages with photos, your review, sent | `hooks/useApply`, `components/apply/*` |

**How this folder connects:** pages compose `components/*` for UI, call
`hooks/*` (TanStack Query) for data → which hit `lib/api.ts` → FastAPI `/v1`.
Auth/session comes from `lib/supabase/client.ts`.
