# Routes Manifest (`frontend/src/routes/`)

React Router **page components** (the app's screens), wired up in
[`src/router.tsx`](../router.tsx). Feature-level status lives in
[docs/FEATURES.md](../../../docs/FEATURES.md).

| File | Route | Purpose | Uses |
|---|---|---|---|
| `DashboardLayout.tsx` | `/` (layout) | Sidebar nav + `<Outlet/>` + sign-out; wraps children in `RequireAuth` | `lib/supabase` |
| `RequireAuth.tsx` | (guard) | Redirect to `/login` if no Supabase session | `lib/supabase` |
| `Login.tsx` | `/login` | Email/password + GitHub sign in/up | `lib/supabase` |
| `AuthCallback.tsx` | `/auth/callback` | OAuth redirect landing → session → `/search` | `lib/supabase` |
| `SearchPage.tsx` | `/search` | Search bar + filters + results | `hooks/useJobs`, `components/jobs` |
| `SavedPage.tsx` | `/saved` | Saved jobs + collections sidebar | `hooks/useSavedJobs`, `components/jobs` |
| `TrackerPage.tsx` | `/tracker` | Kanban board wrapper | `components/tracker` |
| `MatchesPage.tsx` | `/matches` | New-matches feed (saved searches) | `hooks/useSavedSearches` |
| `AnalyticsPage.tsx` | `/analytics` | Personal stats + chart | `hooks/useAnalytics`, `components/analytics` |
| `AiApplyPage.tsx` | `/ai-apply` | AI resume/cover letter (final phase) | `hooks/useAI`, `components/ai` |
| `SettingsPage.tsx` | `/settings` | Data export + account delete | `hooks/useProfile`, `lib/api` |
| `AdminPage.tsx` | `/admin` | Owner-only dashboard (role-guarded) | `hooks/useAdmin`, `components/admin` |
| `Placeholder.tsx` | — | Dev stub for un-ported pages (none currently) | — |

**How this folder connects:** pages compose `components/*` for UI, call
`hooks/*` (TanStack Query) for data → which hit `lib/api.ts` → FastAPI `/v1`.
Auth/session comes from `lib/supabase/client.ts`.
