# Frontend Source Manifest (`frontend/src/`)

The React single-page app (Vite). **Entry chain:** `index.html` →
[`main.tsx`](main.tsx) → [`router.tsx`](router.tsx). Data flows one direction:
**routes → components → hooks → `lib/api` → FastAPI**. Each folder has its own
`MANIFEST.md`.

See [docs/architecture.md](../../docs/architecture.md) for the frontend data flow.

## Top-level files
| File | Purpose |
|---|---|
| `main.tsx` | App entry: mounts React into `index.html`, wraps the app in `Providers` (TanStack Query) + `RouterProvider` |
| `router.tsx` | The route table — maps each URL to a page component in `routes/` |
| `providers.tsx` | `QueryClientProvider` (TanStack Query configuration) |
| `vite-env.d.ts` | Vite type shims (`import.meta.env`) |
| `globals.css` | Tailwind v4 import + theme CSS variables (shadcn); imported by `main.tsx`. |

## Folders (each has its own MANIFEST unless noted)
| Folder | Responsibility |
|---|---|
| `routes/` | Page components — the screens (React Router) |
| `components/` | UI: `ui/` (shadcn primitives) + feature dirs (`jobs`, `tracker`, `ai`, `analytics`, `admin`, `layout`) |
| `hooks/` | TanStack Query data hooks (call the API) |
| `lib/` | `api.ts` (typed fetch + Bearer token) + `supabase/` client + `utils.ts` |
| `types/` | Shared TypeScript types (incl. generated `api.gen.d.ts`) — *no manifest, self-explanatory* |
| `app/` | ⚠️ **Legacy Next.js files** (unimported), pending cleanup — only `globals.css` is used |
