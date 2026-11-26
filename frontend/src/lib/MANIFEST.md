# Lib Manifest (`frontend/src/lib/`)

Shared utilities and external-service clients.

| File | Purpose |
|---|---|
| `api.ts` | Typed fetch wrapper for the FastAPI `/v1` API. Attaches the Supabase access token as `Authorization: Bearer`, throws `ApiError` on non-2xx, redirects to `/login` on 401, handles 204. Exports `api.{get,post,patch,delete}`, `getAccessToken`, `API_BASE`. |
| `supabase/client.ts` | **Singleton** browser Supabase client (`@supabase/supabase-js`) for auth/session. Reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. |
| `supabase/server.ts` | ⚠️ **Legacy** (Next.js SSR cookie helper). Unused in the Vite SPA — pending cleanup. |
| `boardFilter.ts` | Pure board logic: search by title/company (`matchesSearch`), what a column draws (`columnView`: one page, matches first), which column a job belongs in (`stageFor`), marking hits (`highlightParts`). |
| `jobFilters.ts` | Pure My Jobs list logic shared by the desktop and phone lists: `filterJobs` (search, place, pay incl. hourly→yearly, type, applied, remote, where from), `filtersSet`, `jobTypesIn`, `stageCounts`. |
| `origin.ts` | Pure: how a saved job got into My Jobs. `ORIGIN_LABEL`, `originText` (adds Scout's fit score), `originsIn` (filter choices), and the links between pages (`folderLink`, `runLink`). |
| `researchPrompt.ts` | Pure: `buildResearchPrompt(listing)`, the text "Research it with Claude" copies. |
| `stageStyle.ts` | `stageTone(name)`: one colour per kind of stage (chip + dot classes), matched on the stage's name so custom stages fit. |
| `text.ts` | `plainText`: turns HTML entities left in captured titles (`&amp;`) back into characters; output is plain text. |
| `pdfjs.ts` | `loadPdfjs()`: PDF.js (legacy build + its worker via Vite `?url`), loaded only when a file is first shown, so it stays out of the main bundle (spec 025). |
| `prefs.ts` | Layout choices remembered on this device (`localStorage`): `readPref` / `writePref`. |
| `utils.ts` | `cn()` — classname merge (clsx + tailwind-merge), used by shadcn/ui components. |
| `safeRedirect.ts` | `safeRedirect()`: where to go after sign-in, only ever a page inside the app; keeps the target across a GitHub sign-in. |
| `recovery.ts` | `watchPasswordRecovery()`: a reset link opens /reset-password wherever it lands. |
| `jobCatcher.ts` | Job Catcher's pinned id, the download URL, `askProof()` for Connect, `isOlder()`, `outdatedJobCatcher()` (spec 034: any one install — a browser on a computer — seen in 30 days that's behind the newest release, named "Chrome (macOS)" when there's more than one; an up-to-date computer never hides an old one, but a newer current copy on the same browser and system replaces it), `browserLabel()`, `RECENT_MS`. |
| `help.ts` | `HELP`: the words in every ⓘ bubble (what it is, why it helps, what it needs), in one place. |
| `apply.ts` | Apply with Claude (spec 022): run types, the six steps (`STEPS`, `currentStep`), `statusLine` / `needsYou` / `bannerLine`, `pageAnswers` (Job Catcher's reading, Claude's writing marked), `latestPages`, `APPLY_LINE`; spec 030: checklist fields on questions, `openBatch`, `ApplyProblem` / `PROBLEM_KIND`. |
| `bugReport.ts` | Copy for Claude (spec 032, on spec 030's format): `bugReport` (one report, or numbered in a list), `bugsReport` (several under one heading, the data note once), `fenced`, `contextLine`, `utcTime`. |
| `bugs.ts` | Bugs & ideas types and plain words (sections, statuses, severities, sources), `statusesFor`, `sectionForPath` (the add form's guess), `browserName`, `stepsFrom`, `stepsCheck` (a step over 300 characters, more than 12), `saveErrorText` (a refused save in words). |
| `emailSections.ts` | A job's emails in sections (spec 027): `sectionOf`, `groupBySection`, `latestLine`, `isNew` (pure, tested) |

**How this folder connects:** `api.ts` is called by every hook in `hooks/`;
`supabase/client.ts` is used by `api.ts` and the auth routes
(`RequireAuth`, `Login`, `AuthCallback`, `DashboardLayout`).
