# Feature Specification: Phone experience — an app made for a phone, not a squeezed desktop page

**Feature Branch**: `005-phone-experience`
**Created**: 2026-11-19
**Status**: Draft
**Input**: The user, on their phone: "fix everything about the phone view, it's
horrendous UI/UX, can't see anything, can't even see the email thing, I need to
be able to hide Claude Scout easily and intuitively. I want the app to look and
feel different on phone." With a screenshot of My Jobs → List where the header,
view toggle, Add job, folders, search and five filters fill the screen before
one job shows, and the only visible job card is cut off on the right.

Builds on [004-ux-overhaul](../004-ux-overhaul/spec.md): its board is shipped;
its to-dos, Email History and Scout checklist are still to come and are reused
here, not redesigned.

## Why

Measured at 390 × 844 on a copy of the user's data
([research.md](research.md) R1):

- **My Jobs list is 109 screens long.** All ~300 jobs render as tall cards; the
  first job starts at 452 px of 787 usable. One card fits per screen.
- **Email Updates is not in the phone's tab bar.** It is the 7th card down in
  Settings.
- **Every one of 1,159 tappable things on My Jobs is under 40 px** in one
  direction; the email page's "View email" link is about 16 px tall.
- **Cards and fields break**: 18 elements poke past the right edge of the job
  cards; the Find Jobs keyword box shrinks to an icon; a Scout search card runs
  off the screen; the Add job form can't scroll once the keyboard opens.
- **It runs inside browser chrome** with no home-screen install, and iOS zooms
  the page when a filter is tapped.

The phone is where the user checks on their search between other things. It
needs to answer "what needs me?" and "where does this job stand?" in one
thumb's reach.

## User Scenarios & Testing

### User Story 1 — A phone shell: everything one tap away (Priority: P1)

A slim top bar shows where you are and that page's actions. A bottom bar has
**My Jobs · Email · Find Jobs · More**, with a count on Email when updates wait.
**More** opens a sheet with everything else and Sign out. Forms and menus open
as sheets from the bottom. Installed to the home screen, the app runs full
screen.

**Independent test**: on a phone, reach Email Updates in one tap from any page;
open More and reach Matches, AI Apply, Analytics, Settings; add the app to the
home screen and open it without browser bars.

**Acceptance**:
1. Email Updates is in the bottom bar with a count of items to review.
2. More lists every other page; Admin only for admins; Sign out is there.
3. The page title sits in a 48 px sticky bar, not a large heading block.
4. Nothing pokes past the screen edge and the page never scrolls sideways.
5. Tapping a field does not zoom the page.
6. Every button a thumb is meant to press is at least 44 px tall.
7. Dialogs become bottom sheets that scroll inside the screen, keep their
   primary button visible above the keyboard, and close with Back.
8. On a phone the app opens on My Jobs.

### User Story 2 — My Jobs you can scan with a thumb (P1)

Jobs are **rows**: title, company · place, and the stage. Ten fit on a screen.
Stage chips across the top (All · Applied · Interview · …, each with its count)
are the phone's board: one stage at a time. Search and filters hide behind two
icons; filters open in a sheet. Tapping a row opens the job with its actions
pinned at the bottom.

**Independent test**: with 300 saved jobs, see at least 8 jobs on the first
screen; find one by name; move it to Interview; all with one hand.

**Acceptance**:
1. The first job starts within 200 px of the top.
2. At least 8 rows are visible on a 390 × 844 screen.
3. Stage chips filter the list and show counts; the choice is remembered.
4. Search opens from the top bar; filters (folder, place, pay, type, applied,
   remote) live in a sheet with a "Show N jobs" button; active filters show as
   removable chips.
5. The list draws 30 rows and adds more as you scroll.
6. A row's ⋯, or the job page's **Move to**, changes its stage; a failure says
   so with Retry.
7. The job page pins **Apply** and **Move to** at the bottom and collapses long
   descriptions behind "Read more".
8. No List/Board toggle on a phone; rotating to landscape or a wider screen
   gets the board.

### User Story 3 — Email updates built for tapping (P1)

Each update is a card with what the email says and two full-width buttons:
**Move to X** and **Not this**. Tapping the card opens the email in a sheet.
Scan is a button in the top bar; its progress is a slim line under it. The
"move cards automatically" switch lives in Email settings, not above the list.

**Acceptance**:
1. The first update starts within 200 px of the top.
2. No text-only links as actions; each action is a 44 px button.
3. The email opens in a sheet with **See the job** and **Open in Yahoo/Gmail**.
4. To review / History / Other mail (from 004) are a segmented control that
   stays visible while scrolling.

### User Story 4 — Find Jobs, and Claude Scout only if you want it (P2)

Search is one full-width box; place and filters open in a sheet. Results are
rows like My Jobs. **Claude Scout can be hidden**: from the Find Jobs ⋯ menu or
a switch in Settings; hidden, Find Jobs is just search. It comes back from
More or Settings.

**Acceptance**:
1. The keyword box is full width and never collapses.
2. Hide Claude Scout in two taps; show it again in three or fewer.
3. Hiding is per device, so hiding it on the phone leaves it on the computer.
4. The first time Scout is opened on a phone, one line explains it runs in
   Chrome on the computer and offers **Hide on this phone**.
5. With Scout shown: saved searches are rows with a full-width Start; a running
   search shows its progress and findings; resume types list with Upload.

### User Story 5 — The rest, and the feel (P2)

Settings is a grouped list that opens each section on its own screen. Matches,
AI Apply and Analytics use the same rows, sheets and gutters. Presses give
feedback (no hover on a phone). Loading shows skeleton rows.

### Edge cases

- Keyboard open in a sheet → the sheet's content scrolls; the primary button
  stays above the keyboard.
- Back button with a sheet open → closes the sheet, stays on the page.
- A very long job title or company → truncates; never widens the row.
- Phone in landscape or a small tablet (≥ 768 px) → desktop layout.
- Installed app opened offline → the existing offline banner, no white screen.
- Scout hidden while a search is running → the run continues; More shows
  "Claude Scout (hidden) · 1 running".
- 0 jobs / 0 updates → an empty state with one button, not a blank list.

## Requirements

- **FR-001** Phone shell under 768 px: sticky top bar (title + page actions),
  bottom bar My Jobs · Email · Find Jobs · More, More sheet.
- **FR-002** Counts on the Email tab (to review) and My Jobs (open to-dos, when
  004's to-dos exist).
- **FR-003** One 16 px gutter; no nested page padding; no horizontal overflow.
- **FR-004** Touch sizing: 44 px minimum for buttons, chips, tabs and row
  actions on touch screens; 16 px text in every field.
- **FR-005** Bottom sheets replace dialogs on phones (same content), scroll
  inside the viewport, respect the safe areas and the keyboard, close on Back.
- **FR-006** Installable: web app manifest, icons, theme colour, standalone
  display, `viewport-fit=cover`.
- **FR-007** My Jobs phone list: rows, stage chips with counts, search, filter
  sheet, active-filter chips, incremental loading.
- **FR-008** Job page on phone: sticky bottom actions, collapsed description,
  wraps long words and links.
- **FR-009** Email Updates phone layout per User Story 3.
- **FR-010** Find Jobs phone layout; result rows; filter sheet.
- **FR-011** Hide / show Claude Scout, per device, from Find Jobs and Settings.
- **FR-012** Settings as a grouped list on phones; Matches, AI Apply, Analytics
  brought onto the shared pieces.
- **FR-013** Press feedback, skeletons, reduced motion honoured.
- **FR-014** Desktop is unchanged except where a shared fix helps both (list
  paging, overflow fixes).

## Success Criteria

Measured by the phone audit script at 390 × 844 (see
[quickstart.md](quickstart.md)); today's value in brackets.

- **SC-001** My Jobs: first job within 200 px of the top [452]; ≥ 8 jobs on the
  first screen [1]; page ≤ 4 screens before scrolling loads more [109].
- **SC-002** Email Updates reachable in 1 tap from every page [3 taps and a
  scroll].
- **SC-003** 0 elements past the right edge on any page [18 on My Jobs].
- **SC-004** 0 primary actions under 44 px [1,159 of 1,159 controls on My Jobs
  under 40 px].
- **SC-005** No page zoom on focusing any field.
- **SC-006** Claude Scout hidden in ≤ 2 taps, shown again in ≤ 3.
- **SC-007** Installed app opens with no browser bars.

## Out of scope

- A native iOS/Android app, push notifications, offline use.
- Swipe-to-act on rows and drag-to-dismiss sheets (later, once the basics are
  proven).
- Redesigning what the pages do: to-dos, Email History and the Scout checklist
  stay as planned in 004.
- Tablet-specific layouts (≥ 768 px uses the desktop layout).
