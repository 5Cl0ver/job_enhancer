# Lib Manifest (`frontend/src/lib/`)

Shared utilities and external-service clients.

| File | Purpose |
|---|---|
| `api.ts` | Typed fetch wrapper for the FastAPI `/v1` API. Attaches the Supabase access token as `Authorization: Bearer`, throws `ApiError` on non-2xx, redirects to `/login` on 401, handles 204. Exports `api.{get,post,patch,delete}`, `getAccessToken`, `API_BASE`. |
| `supabase/client.ts` | **Singleton** browser Supabase client (`@supabase/supabase-js`) for auth/session. Reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. |
| `supabase/server.ts` | ⚠️ **Legacy** (Next.js SSR cookie helper). Unused in the Vite SPA — pending cleanup. |
| `utils.ts` | `cn()` — classname merge (clsx + tailwind-merge), used by shadcn/ui components. |

**How this folder connects:** `api.ts` is called by every hook in `hooks/`;
`supabase/client.ts` is used by `api.ts` and the auth routes
(`RequireAuth`, `Login`, `AuthCallback`, `DashboardLayout`).
