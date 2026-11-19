# Implementation Plan: Phone experience

**Branch**: `005-phone-experience` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-phone-experience/spec.md`

## Summary

Under 768 px the app gets its own arrangement instead of a narrowed desktop
page: a slim top bar and a four-tab bottom bar (**My Jobs · Email · Find Jobs ·
More**), bottom sheets in place of dialogs, jobs and results as dense rows,
stage chips as the phone's board, filters in a sheet, 44 px touch targets, and
a home-screen install that drops the browser bars. The phone does everything
the computer does; nothing is hidden. Measured starting point and causes are in
[research.md](research.md) R1; the screens are specified in
[contracts/ui.md](contracts/ui.md).

## Technical Context

**Language/Version**: TypeScript 5 / React 19 (frontend); Python 3.11 only for the one shared endpoint
**Primary Dependencies**: Vite, React Router 7, TanStack Query v5, Tailwind 4.3 (`pointer-coarse:` variant), shadcn/ui on Radix (Dialog doubles as the bottom sheet under 768 px), lucide. **No new runtime dependency.**
**Storage**: none on the server. One `localStorage` key and a few URL params ([data-model.md](data-model.md))
**Testing**: Vitest + Testing Library with a `matchMedia` stub for phone vs desktop; Playwright at 390 × 844 (touch) for the measured criteria; pytest for `/attention`
**Target Platform**: phone browsers (iOS Safari/Chrome, Android Chrome) and the same app installed to the home screen; Vercel + Render as today
**Project Type**: Web application (existing `frontend/` + `backend/`)
**Performance Goals**: My Jobs first paint draws ≤ 30 rows (today ~300 cards); first job within 200 px; no layout shift when the tab bar or top bar mounts; search stays under 100 ms per keystroke
**Constraints**: $0 hosting; no service worker; desktop layout unchanged; WCAG 2.1 AA plus 44 px targets on touch; no horizontal scroll at 320–430 px; safe areas respected; reduced motion honoured
**Scale/Scope**: 9 routes on phones; ~14 new components (shell, sheet, rows, filter sheet, phone pages), ~8 touched; 1 small endpoint

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | A measured before/after (audit table, success criteria with today's values), phone screenshots for the README, installable app |
| II. User-centric | Driven by the user's own phone screenshot; the two things they do on a phone (check jobs, check email) are tabs; nothing is taken away on a phone |
| III. AI-powered | No AI change. Scout is fully usable from a phone |
| IV. Security & privacy | No new data; preferences are layout-only and local; `/attention` returns counts, never content, and is user-scoped |
| V. Tests | Each slice ships with component tests (phone and desktop renders) and a Playwright phone spec that asserts the measured criteria, so regressions in overflow, target size or first-item position fail CI |
| VI. Clean architecture | Phone pieces are separate components chosen by one `useIsPhone` hook; data hooks and pure helpers (`boardFilter`, `emailUpdates`, new `jobFilters`) are shared; preferences go through `lib/prefs.ts` |
| VII. Simplicity | Sheets on the existing Radix Dialog rather than a new library; no service worker; no server state; chips instead of touch drag-and-drop |

Gate: **pass**. Re-checked after design: still pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-phone-experience/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rest-api.md
│   └── ui.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code (repository root)

```text
frontend/
├── index.html                              # viewport-fit, theme-color, icons, manifest link
├── public/{manifest.webmanifest, icon-192.png, icon-512.png, icon-maskable.png, apple-touch-icon.png}
├── src/
│   ├── hooks/{useIsPhone,useAttention}.ts
│   ├── lib/{prefs,jobFilters}.ts           # pure: preference keys; filter + stage-count logic
│   ├── components/ui/{sheet,button,input}.tsx   # sheet new; touch sizes on button/input
│   ├── components/common/{ResponsiveDialog,TopBar,ActionSheet,SegmentedControl}.tsx
│   ├── components/layout/{PhoneShell,TabBar,MoreSheet}.tsx
│   ├── components/jobs/{JobRow,JobList,StageChips,FilterSheet,JobActions}.tsx
│   ├── components/email/{UpdateCard,EmailSheet}.tsx
│   ├── components/scout/{ScoutNote}.tsx    # + phone branches in ScoutStart/ResumeTypes
│   ├── components/settings/SettingsList.tsx
│   └── routes/{DashboardLayout,MyJobsPage,JobDetailPage,EmailUpdatesPage,SearchPage,SettingsPage,…}.tsx
├── tests/{lib/{prefs,jobFilters}.test.ts,
│          components/{PhoneShell,JobList,FilterSheet,UpdateCard,ScoutPhone}.test.tsx}
└── tests/e2e/phone.spec.ts                 # 390×844: first-item top, overflow, target sizes, tabs

backend/
├── app/api/v1/attention.py, app/schemas/attention.py   # unless 004 shipped it first
└── tests/api/test_attention.py
```

**Structure Decision**: existing web-app layout. Phone-only components live
beside their desktop siblings; shared phone building blocks go in
`components/common/` and `components/layout/`.

## Delivery slices

Each is its own branch → PR → review → CI → merge, and improves the phone by
itself.

1. **Shell + My Jobs list** (US1, most of US2) — *shipped first*: `useIsPhone`;
   top bar; four-tab bar with the Email count (`/attention`); More sheet; phone
   lands on My Jobs; one gutter; `viewport-fit`, manifest, icons; 44 px touch
   sizes; dialogs as bottom sheets (in `ui/dialog` itself, so every dialog
   gets it); the Find Jobs keyword box and the clipped job card fixed. My Jobs
   on a phone: rows, stage chips, search, filter sheet, paging (also on the
   desktop list). *The list in the user's screenshot was the worst screen, so
   it didn't wait for slice 2.*
2. **My Jobs, the rest** (US2): row action sheet (Move to, Mark applied,
   Remove), job page with pinned actions and a collapsed description, the
   List/Board toggle dropped on phones.
3. **Email** (US3): update cards with full-width actions, email sheet, scan in
   the top bar, the auto-move switch moved to Email settings.
4. **Find Jobs + Scout** (US4): search layout, filter sheet, result rows;
   Scout's phone views, with every action the computer has.
5. **The rest** (US5): Settings as a grouped list; Matches, AI Apply,
   Analytics; press states and skeletons; phone screenshots in the README.

Order relative to 004: 004's to-dos (slice 2) and Email History (slice 3) plug
into the phone pieces as they land; neither blocks slice 1 or 2 here.

## Risks

| Risk | Handling |
|---|---|
| iOS Safari quirks (dynamic toolbar height, keyboard covering pinned buttons) | Use `dvh` and `env(safe-area-inset-*)`; pin sheet footers with `position: sticky` inside the scroller; check on the user's own iPhone before each merge |
| Desktop regressions from shared edits (button sizes, gutters) | Touch sizes are behind `pointer-coarse:`; gutter change is phone-only; desktop screenshots compared before/after in each PR |
| Two layouts drifting apart | Shared hooks and pure helpers; component tests render both; the phone spec runs in CI |
| An installed copy showing an old version | No service worker, so the browser's normal cache rules apply; Vercel serves hashed assets |

## Complexity Tracking

None.
