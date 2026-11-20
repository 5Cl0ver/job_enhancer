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
| `stageStyle.ts` | `stageTone(name)`: one colour per kind of stage (chip + dot classes), matched on the stage's name so custom stages fit. |
| `text.ts` | `plainText`: turns HTML entities left in captured titles (`&amp;`) back into characters; output is plain text. |
| `openFile.ts` | `openOwnFile(path)`: open one of the user's own files (a resume) in a new tab; fetched with the sign-in token, since a plain link can't send it. |
| `prefs.ts` | Layout choices remembered on this device (`localStorage`): `readPref` / `writePref`. |
| `utils.ts` | `cn()` — classname merge (clsx + tailwind-merge), used by shadcn/ui components. |

**How this folder connects:** `api.ts` is called by every hook in `hooks/`;
`supabase/client.ts` is used by `api.ts` and the auth routes
(`RequireAuth`, `Login`, `AuthCallback`, `DashboardLayout`).
