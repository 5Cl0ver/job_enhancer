# Research: Phone experience

## R1. What the phone shows today (measured 2026-11-19)

Playwright, 390 × 844, touch, on a local copy of the user's data (~300 saved
jobs). Numbers only; "under 40 px" means under 40 px in either direction.

| Page | Screens long | First item starts at | Controls / under 40 px | Past the right edge |
|---|---|---|---|---|
| My Jobs (list) | **109** | 452 px of 787 | 1,159 / 1,159 | 18 |
| Email Updates | 2.8 | 120 px | 43 / 37 | 0 |
| Find Jobs (job boards) | 1 | n/a | 5 / 5 | 0 |
| Claude Scout · Start | 1 | 456 px | 8 / 8 | card overflows |
| Claude Scout · Resume types | 1.8 | 456 px | 11 / 11 | 0 |
| Settings | 4.4 | 120 px | 34 / 33 | 0 |

Causes found in the code:

| Problem | Cause | Where |
|---|---|---|
| No Email tab | Email Updates isn't `primary`; phone users reach it from a card that is 7th in Settings. Admin is listed for everyone. | `routes/DashboardLayout.tsx` NAV, `routes/SettingsPage.tsx` MoreNavCard |
| A screen of controls before the first job | Title + subtitle, List/Board, Add job, folder chips, search, Location, pay, type, applied, Remote and a count are stacked. | `routes/MyJobsPage.tsx`, `components/jobs/SavedJobsBody.tsx`, `CollectionSidebar.tsx` |
| One job per screen, 109 screens | Every job renders, as a full card with a 3-line description. No paging. | `SavedJobsBody.tsx`, `components/jobs/JobCard.tsx` |
| Card cut off on the right | The header row has no `min-w-0`; badges are `nowrap` + `shrink-0`; the card's `overflow-hidden` clips instead of wrapping. | `JobCard.tsx`, `ui/card.tsx` |
| Narrow content | Pages add `container px-4` inside the layout's `p-4`: 32 px each side. | every route |
| Tiny buttons | `ui/button` sizes are 32/36 px; card actions are 28 px; email actions are bare 12 px text. | `ui/button.tsx`, `JobCard.tsx`, `EmailUpdatesPage.tsx` |
| Page zooms on tap (iOS) | Filter fields are 14 px text. | `SavedJobsBody.tsx`, `SearchFilters` |
| Keyword box shrinks to an icon | Keyword, location (max 200 px) and Search share one non-wrapping row. | `components/jobs/SearchBar.tsx` |
| Add job can't scroll | The base dialog has no max height; long forms run off-screen under the keyboard. | `ui/dialog.tsx`, `AddJobDialog.tsx` |
| Safe-area padding does nothing | No `viewport-fit=cover`, so `env(safe-area-inset-*)` is 0 on iOS. | `index.html` |
| Browser chrome eats the screen | No manifest, icons or theme colour; can't be installed. | `index.html` (no `public/`) |

There is no "is this a phone" hook: everything is Tailwind breakpoints, which
can restyle but can't swap a dialog for a sheet or a card for a row.

## R2. Navigation: four tabs and a More sheet

**Decision**: bottom bar **My Jobs · Email · Find Jobs · More**. Email carries a
count. More opens a bottom sheet: Matches, AI Apply, Analytics, Settings, Admin
(admins only), Sign out. A 48 px sticky top bar
holds the page title and that page's actions. On a phone `/` opens My Jobs.

**Rationale**: a bottom bar is for three to five destinations of equal weight,
with badges for pending counts
([Material: bottom navigation](https://material.io/components/bottom-navigation),
[M3 navigation bar usage](https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-bar/usage)).
What the user does on a phone is check on jobs and email updates and sometimes
search; Matches, AI Apply and Analytics are desk tasks. Four slots are wider
targets than five. Settings was a tab only because it hid the other pages.

**Alternatives**: five tabs (adds Matches: smaller targets, rarely used on a
phone); a hamburger drawer (hides everything; one more tap for Email); keep the
More list in Settings (today's problem).

## R3. Phone layouts are separate components, not breakpoints

**Decision**: a `useIsPhone()` hook (`matchMedia("(max-width: 767px)")`) picks
between the desktop piece and a phone piece where the *structure* differs: row
vs card, sheet vs dialog, stage chips vs board. Data hooks and pure helpers are
shared. Spacing and sizing differences stay in Tailwind (`pointer-coarse:` for
touch sizes; Tailwind 4.3 is installed).

**Rationale**: "look and feel different on a phone" is a different
arrangement, not smaller columns. Keeping the phone pieces in their own files
keeps the desktop ones readable and lets each be tested alone.

**Alternatives**: breakpoints only (can't express sheets or rows cleanly; what
exists now); a separate mobile site (two apps to keep in step).

## R4. My Jobs: rows, with stages as chips

**Decision**: a dense list of rows (title; company · place; stage chip), 30 at
a time. Stage chips with counts across the top are the phone's board. Search
and filters open from the top bar. No List/Board toggle under 768 px.

**Rationale**: a phone can't show several columns; the working patterns are
one column at a time or a list grouped by status
([37signals: Card Table on the small screen](https://dev.37signals.com/bringing-card-table-to-the-small-screen/),
[KanbanFlow mobile](https://kanbanflow.com/mobile-app),
[GitScrum mobile board](https://docs.gitscrum.com/en/mobile/kanban-board)).
Chips give the same thing as swiping columns, with every stage's count visible
and one tap away, and no long-press drag (the part tools get wrong on touch:
[ClickUp request](https://feedback.clickup.com/feature-requests/p/drag-and-drop-tasks-on-kanban-board-mobile-app),
[Airtable thread](https://community.airtable.com/t/moving-kanban-cards-on-touchscreen-devices/27442)).
Moving is a menu, as already built for the board's "Move to".

**Alternatives**: keep the snap-scrolling board on phones (shipped in 004 as a
stopgap; fine for a glance, poor for 183 cards); swipe between columns (no
counts in view, and conflicts with the browser's back-swipe).

## R5. Filters in a sheet

**Decision**: a Filter button with a count opens a bottom sheet (folder, place,
pay, type, applied, remote) with **Show N jobs** and **Clear**. Active filters
appear under the top bar as chips that can be removed one by one.

**Rationale**: inline filters don't fit a phone; they belong on their own layer
behind a labelled button, with applied filters kept in view
([Baymard: filter UI](https://baymard.com/learn/ecommerce-filter-ui),
[Baymard: applied filters](https://baymard.com/research-articles/how-to-design-applied-filters)).

## R6. Sheets without a new dependency

**Decision**: the app's one `Dialog` (Radix, already installed) becomes a
bottom sheet under 768 px, in CSS: slides up, rounded top, grab bar,
`max-h-[92dvh]`, scrolls inside, pads for the safe area, footer pinned for the
primary button. Every existing dialog gets it with no change at its call site,
and there is no second component to keep in step. Sheets that stand for a
place (a job, an email) are URL params, so Back closes them.

**Rationale**: sheets suit contextual detail and short tasks, should close with
Back, and always need a visible close control; long multi-step work belongs on
a full page ([NN/g: bottom sheets](https://www.nngroup.com/articles/bottom-sheet/),
[Air France DS](https://design.airfrance.com/latest/components/blueweb-components/bottom-sheet/usage-CFOQ0Rya)).
So: filters, Move to, More, Add job, the email viewer → sheets; a job → full
page with pinned actions.

**Alternatives**: `vaul` (drag-to-dismiss; what shadcn's Drawer wraps). Its
latest release is 1.1.2 from December 2024, and a swipe needs a close button
anyway; revisit if drag is missed. Keyboard caveat for text fields in
half-height sheets
([DevExpress note](https://community.devexpress.com/blogs/mobile/archive/2023/10/12/net-maui-mobile-collection-filtering-best-practices.aspx)):
sheets with inputs open tall.

## R7. Touch sizes and type

**Decision**: on touch screens (`pointer: coarse`) buttons, chips, tabs and row
actions are at least 44 px; adjacent targets keep 8 px apart; every field is
16 px text. Desktop sizes don't change.

**Rationale**: 44 pt (Apple), 48 dp (Material) and WCAG 2.5.5 (44 × 44 CSS px)
agree; WCAG 2.2's floor is 24 px with spacing
([target size overview](https://tetralogical.com/blog/2022/12/20/foundations-target-size/),
[Ahmad Shadeed: target size](https://ishadeed.com/article/target-size/)).
iOS zooms the page for fields under 16 px.

## R8. Parity: the phone does everything the computer does

**Decision**: no feature is hidden, removed or switched off on a phone. Each
screen is rearranged for a thumb; none loses an action. Claude Scout stays in
Find Jobs with all three views.

**Rationale**: the user said so in as many words ("I need everything to work on
my phone as if it was on the computer"). Scout in particular is usable from a
phone: the line it gives can be pasted into Claude on the phone, which drives
Chrome on the computer.

**Withdrawn**: an earlier draft planned a per-device "hide Claude Scout"
switch, from a misread message. It was never asked for.

## R9. Installable, no service worker

**Decision**: `manifest.webmanifest` (name, icons 192/512 + maskable,
`display: standalone`, theme and background colours), `apple-touch-icon`,
`theme-color` per colour scheme, `viewport-fit=cover`. No service worker.

**Rationale**: standalone display removes the browser bars that take a fifth
of the screen in the user's screenshot. Offline use isn't a goal, and a
service worker's caching is a classic source of "the update isn't showing".
iOS installs from Share → Add to Home Screen with just the manifest and icon.

## R10. The list download is already light

**Checked**: `GET /saved-jobs/` returns `SavedJobListItem`, whose listing is a
`JobListingSummarySchema`: a short `description_preview`, not the full text.
Phone rows don't use even the preview. **Decision**: no API change; the cost on
a phone is drawing 300 cards, which paging fixes (R4). The list stays one
request so stage counts and search work without the server.
