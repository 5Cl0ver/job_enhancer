# Frontend Migration Plan: Next.js → Vite + React + React Router

**Feature**: `001-job-search-mvp` | **Type**: Frontend architecture migration
**Date**: 2026-07-28 | **Scope**: Frontend only — backend, database, and API contract are UNCHANGED

> This is a **self-contained plan** for swapping the frontend framework. It does
> not change any product requirement in [spec.md](spec.md), any backend code, the
> [data model](data-model.md), or the [API contract](contracts/openapi.yml). It
> replaces *how* the frontend is built and served, not *what* it does.

---

## 1. Goal

Replace the Next.js App Router frontend with a **Vite + React + TypeScript
single-page application (SPA)** that uses **React Router** for navigation. Keep
every other frontend technology (TanStack Query, Tailwind CSS, shadcn/ui,
Supabase Auth) and keep talking to the existing FastAPI backend over the same
Bearer-token REST API.

Two motivations, equally weighted:
1. **Practical** — the workplace standard the developer must match is "plain
   React" (Vite + React Router), and Next.js's headline feature (its built-in
   backend / server rendering) is dead weight here because a separate FastAPI
   backend already exists.
2. **Educational** — the developer is learning React/Vite/React Router to apply
   for full-stack roles and wants to understand each layer, not cargo-cult it.

## 2. Background — why this is a *small* migration

A survey of the current `frontend/src` tree:

| Metric | Value | Implication |
|---|---|---|
| Total `.tsx` files | 53 | — |
| Already client components (`"use client"`) | 41 (~77%) | App is already a client-side SPA in all but name |
| Files importing `next/navigation` | 10 | Mechanical hook swap |
| Files importing `next/link` | 5 | Mechanical `<Link>` swap |
| Files importing `next/font/google` | 1 | Replace with a font `<link>` |
| Server-only bits (`next/headers`, `next/server`) | 2 | Only in the auth callback route |
| Next route handlers (`app/**/route.ts`) | 1 | The Supabase auth callback |
| Server Actions (`"use server"`) | 0 | Nothing to port |
| `middleware.ts` | none | Nothing to port |

Because the app is already ~77% client components talking to an external API,
the Next-specific surface area is tiny and maps almost 1:1 onto React Router.

## 3. Scope

### Changes (frontend only)
- **Build tool**: Next.js → Vite (`@vitejs/plugin-react`)
- **Routing**: Next file-based App Router → React Router (`react-router-dom`),
  one explicit route config replacing the `app/` folder convention
- **Navigation APIs**: `next/navigation` hooks → React Router hooks (see §5)
- **Links**: `next/link` `<Link href>` → `react-router-dom` `<Link to>`
- **`"use client"` directives**: removed everywhere (no server components in a
  Vite SPA — every component is a client component)
- **Auth callback**: the one `app/auth/callback/route.ts` handler → a client-side
  `<AuthCallback>` route page that calls Supabase's session exchange
- **Supabase client**: `@supabase/ssr` (server+client helpers) → `@supabase/supabase-js`
  (a single browser client)
- **Fonts**: `next/font/google` → a `<link>` in `index.html` (or `@fontsource/*`)
- **Env vars**: `NEXT_PUBLIC_*` → `VITE_*`, read via `import.meta.env.VITE_*`
- **Entry/HTML**: add `index.html` + `src/main.tsx` (Vite entry); remove
  `app/layout.tsx` root shell in favor of a React layout + `<RouterProvider>`

### Unchanged (kept verbatim or nearly so)
- **TanStack Query** hooks (`src/hooks/*`) — framework-agnostic, ~0 changes
- **shadcn/ui** components (`src/components/ui/*`) — plain React + Tailwind
- **Tailwind CSS** — same utility classes; only the build wiring differs
- **The API client** (`src/lib/api.ts`) and all typed API calls
- **Page/feature components' JSX and logic** — only their imports change
- **Everything backend**: FastAPI, models, `/v1` endpoints, Supabase DB/Auth,
  Alembic, tests, `render.yaml`, `keep-alive.yml`

### Explicitly out of scope
- Any backend change
- Any product/requirement change (all FRs in spec.md stand as-is)
- Server-side rendering / SEO (irrelevant: this is a logged-in app)
- Next.js image optimization (not used)

## 4. Key Decisions (research)

### D1 — Build tool: **Vite**
- **Decision**: Vite with `@vitejs/plugin-react`.
- **Rationale**: De-facto standard for modern React SPAs; extremely fast dev
  server + HMR; minimal config; static build deploys free anywhere.
- **Alternatives**: Create React App (deprecated/unmaintained — rejected);
  Parcel/Rspack (less common in job postings — rejected for transferability).

### D2 — Routing: **React Router (`react-router-dom` v6/v7)**
- **Decision**: React Router with a single `createBrowserRouter` config and
  nested routes for the dashboard layout.
- **Rationale**: The most in-demand React routing library (maximizes job
  transferability); explicit route table is easy to read and teach; maps
  directly onto the current `(dashboard)` layout + child pages.
- **Alternatives**: **TanStack Router** — newer, fully type-safe, pairs with the
  TanStack Query already in use, but appears in far fewer job postings and adds a
  second "TanStack" concept to learn. **Rejected** to keep the stack standard and
  the learning focused: React Router for pages, TanStack Query for data.

### D3 — Auth: **Supabase client-only (`@supabase/supabase-js`)**
- **Decision**: A single browser Supabase client created from
  `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. OAuth redirect
  returns to a client route `/auth/callback` that calls
  `supabase.auth.exchangeCodeForSession(...)` then navigates into the app.
- **Rationale**: An SPA has no server to run `@supabase/ssr` cookie helpers; the
  browser client + `onAuthStateChange` is the canonical SPA pattern. The access
  token is still attached as `Authorization: Bearer <jwt>` to FastAPI calls
  exactly as today (backend JWT verification is unchanged).
- **Route protection**: a `<RequireAuth>` wrapper component that checks the
  Supabase session and redirects to `/login` — replaces Next's server-side gate.

### D4 — Env vars: **`VITE_` prefix**
- **Decision**: `NEXT_PUBLIC_API_URL` → `VITE_API_URL`,
  `NEXT_PUBLIC_SUPABASE_URL` → `VITE_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `VITE_SUPABASE_ANON_KEY`.
- **Rationale**: Vite only exposes vars prefixed `VITE_` to browser code (via
  `import.meta.env`), a deliberate safety boundary. Same public-only rule as
  `NEXT_PUBLIC_` — no secrets.

### D5 — Deploy: **static SPA on Vercel**
- **Decision**: Keep Vercel; deploy the Vite build output (`dist/`) as a static
  site with an SPA rewrite (all paths → `/index.html` so client routing works on
  refresh). Netlify/Cloudflare Pages are drop-in equivalents.
- **Rationale**: Zero cost, no server needed, no cold starts (the frontend is
  static files on a CDN). The FastAPI backend deploy (Render) is untouched.

## 5. The Next → React Router mapping (reference)

| Concern | Next.js (now) | React Router (after) |
|---|---|---|
| Programmatic navigate | `const r = useRouter(); r.push(url)` | `const nav = useNavigate(); nav(url)` |
| Current path | `usePathname()` | `useLocation().pathname` |
| Query string | `useSearchParams()` (read-only) | `const [sp, setSp] = useSearchParams()` (read+write) |
| Link | `import Link from "next/link"; <Link href>` | `import { Link } from "react-router-dom"; <Link to>` |
| Redirect (in component) | `redirect()` / `router.replace()` | `<Navigate to=.. replace />` or `nav(url,{replace:true})` |
| Route params | folder `[id]` + `params` prop | `:id` in path + `useParams()` |
| Page definition | `app/x/page.tsx` (file convention) | `{ path: "x", element: <X/> }` (config) |
| Shared layout | `app/(dashboard)/layout.tsx` | a layout route with `<Outlet/>` |
| Root shell / `<html>` | `app/layout.tsx` | `index.html` + `src/main.tsx` |
| Env var | `process.env.NEXT_PUBLIC_X` | `import.meta.env.VITE_X` |
| Client boundary | `"use client"` at top | (delete — everything is client) |

## 6. Migration phases (ordered)

Each phase leaves the app in a known state. Detailed per-file tasks will be
generated into [tasks.md](tasks.md) by `/speckit-tasks`; this is the ordering.

- **M0 — Baseline**: run the current Next.js app locally once (needs Supabase
  keys) so we have a known-good visual/behavioral reference to compare against.
- **M1 — Scaffold Vite**: new Vite React-TS project config (`vite.config.ts`,
  `index.html`, `src/main.tsx`, `tsconfig` paths for `@/`), Tailwind wired into
  Vite, shadcn/ui path aliases preserved. App boots with an empty router.
- **M2 — Routing skeleton**: build the `createBrowserRouter` config mirroring the
  existing routes (`/login`, `/search`, `/saved`, `/tracker`, `/matches`,
  `/analytics`, `/admin`, `/settings`, `/ai-apply`, `/auth/callback`) with the
  dashboard layout as a parent route + `<Outlet/>`. Stub pages.
- **M3 — Move shared plumbing**: port `lib/` (api client, supabase client → browser
  client), `hooks/` (TanStack Query — near-verbatim), `components/ui/` (verbatim),
  `types/` (verbatim). Set up the QueryClientProvider at the root.
- **M4 — Auth**: browser Supabase client, `<AuthCallback>` route, `<RequireAuth>`
  wrapper on the dashboard layout, login page wired to Supabase OAuth + email/pw.
- **M5 — Port feature components**: move `components/jobs|tracker|analytics|admin|ai|layout`
  and the page bodies; mechanically apply the §5 mapping (swap nav hooks, `<Link>`,
  delete `"use client"`). Work page-by-page: search → saved → tracker → matches →
  analytics → settings → admin → ai-apply.
- **M6 — Env + build**: `.env` → `VITE_*`, update `frontend/.env.example`,
  `import.meta.env` reads, verify `npm run build` (tsc + vite) is clean.
- **M7 — Deploy config**: Vercel static-SPA rewrite (`vercel.json` or project
  settings), remove Next-specific config (`next.config.ts`, `next` deps).
- **M8 — Verify + clean up**: run through the §7 checklist, delete dead Next files,
  update README + this repo's docs, update the constitution's stack table.

## 7. Validation / quickstart (how we prove it works)

After M5+ the app must pass the same user-visible checks as the Next.js version.
Run locally (`npm run dev`, Vite serves on `:5173` by default) and verify:

- [ ] App loads at `/`; unauthenticated user is redirected to `/login`
- [ ] Email/password sign-in works; OAuth round-trips through `/auth/callback`
- [ ] After login, dashboard layout + nav render; deep-linking to `/tracker` and
      refreshing the page still works (SPA rewrite / dev fallback)
- [ ] **Search** (`/search`): typing a query updates the URL `?q=` and results
      load from FastAPI (proves TanStack Query + API client + Bearer token intact)
- [ ] **Saved / Collections** (`/saved`): save/unsave persists
- [ ] **Tracker** (`/tracker`): Kanban drag-and-drop moves a job between stages
- [ ] **Matches / Analytics / Admin / Settings** render without console errors
- [ ] `npm run build` completes with no TypeScript errors
- [ ] Existing Vitest component tests pass (import paths updated); Playwright E2E
      updated for the new dev server URL/port

**Regression guard**: keep the Next.js frontend in git history (a branch/tag)
until M8 verification passes, so we can diff behavior or roll back.

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Auth cookie/session differences (SSR→SPA) | Medium | Use `onAuthStateChange` + `exchangeCodeForSession`; test OAuth + refresh early (M4) |
| Page-refresh 404 on nested routes | Medium | Configure SPA fallback rewrite in dev (Vite handles) and prod (`vercel.json`) |
| shadcn/ui path aliases (`@/`) break | Low | Mirror the `@/*` alias in `vite.config.ts` + `tsconfig.json` |
| Test suite references Next | Low | Update Vitest config + import paths in M8; adjust Playwright base URL |
| Scope creep into backend | Low | Backend is explicitly frozen for this migration |

## 9. Constitution check

| Principle | Status | Note |
|---|---|---|
| I. Portfolio-Grade Quality | PASS | Cleaner, more standard stack; README/docs updated in M8 |
| II. User-Centric Design | PASS | No user-facing behavior change; SPA keeps interactions instant |
| III. AI-Powered Intelligence | N/A | AI phase unaffected (still last) |
| IV. Security & Privacy | PASS | Public-only `VITE_` vars; Bearer JWT + backend verification unchanged. NOTE: constitution §IV/§VI name "NextAuth.js"/"Next.js" — update to "Supabase Auth"/"React SPA" in M8 |
| V. Test-Driven Confidence | PASS | Existing tests ported; build + typecheck gate retained |
| VI. Clean Architecture | PASS | Sharper boundary — pure client SPA ↔ documented `/v1` API |
| VII. Simplicity & Pragmatism | PASS | Removes an unused framework layer; net less code |

**Gate**: PASS. The migration *increases* alignment with Principle VII
(simplicity) and requires a minor constitution wording update (M8) to replace
Next.js/NextAuth references — tracked, not a violation.
