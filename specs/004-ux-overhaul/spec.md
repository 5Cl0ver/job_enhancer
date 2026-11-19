# Feature Specification: UX overhaul — a board that works, a clear "needs you" list, email updates you can follow

**Feature Branch**: `004-ux-overhaul`
**Created**: 2026-11-19
**Status**: Draft
**Input**: User feedback after the first day of real use with ~200 saved jobs:
cards won't move on the board; no way to search the board; nothing shows which
jobs are waiting on the user (an assessment or recorded interview was detected
from email, then "disappeared"); the board makes you scroll the whole page;
Email updates shows errors and a scan stuck at "0 emails read"; "View email"
doesn't open the email itself; Claude Scout doesn't say how to start and hides
the resume upload behind Edit. "The UI/UX is poorly made — fix all of it."

## Why

The app now holds real volume (183 cards in one column), and the screens were
built for a handful of jobs. An audit of the code ([research.md](research.md) R1)
found the complaints are mostly real defects, not taste:

- A card dropped onto another card does nothing, so moving a job into any
  column that already has cards usually fails, silently.
- Nothing in the data says "the user has something to do for this job", so an
  interview or assessment found in email has nowhere to show up.
- After the user acts on an email update it vanishes from the page.
- A scan is one long request per pass; when the server is busy it dies and the
  page can only say "The scan stopped".

## User Scenarios & Testing

### User Story 1 — A board that works at 200 jobs (Priority: P1)

The user opens My Jobs → Board and sees every stage without scrolling the page.
They type a company or job name and the matching cards light up; they drag a
card (or use "Move to…") and it moves, or they are told why it didn't.

**Independent test**: with 200 saved jobs, find one by name, move it to another
stage by dragging it onto a column full of cards, and reload: it stayed.

**Acceptance**:
1. The board fits the window; each column scrolls on its own and its header
   (name + count) stays visible.
2. Dropping a card anywhere in a column, including on top of another card,
   moves it there.
3. Every card has a "Move to…" menu, so moving works on a phone and by keyboard.
4. If a move fails, the card goes back and a message says so with **Retry**.
5. Typing in the search box dims non-matching cards and highlights matches, in
   both List and Board views; the count of matches per column is shown. Choosing
   a result scrolls its card into view and pulses it once.
6. A long column shows its first 30 cards and a "Show more" control; search
   always looks through every card.
7. Empty stages collapse to a narrow rail that still accepts drops.
8. Hovering a card lifts it and shows its quick actions.
9. A saved job with no stage appears in the first stage instead of nowhere.

### User Story 2 — "Needs you": what I have to do, in one place (P1)

When an email says the user has an interview, an assessment (including a
recorded video interview) or an offer, the job gets a **to-do**. To-dos show as
a coloured badge on the card, in a **Needs you** panel at the top of My Jobs and
as a count in the navigation. The user can add their own, set a date, and tick
them off.

**Independent test**: an assessment email for a saved job is scanned; the job's
card shows "Assessment to do", it is first in Needs you, the nav shows 1;
ticking it off clears all three.

**Acceptance**:
1. An interview, assessment or offer email matched to a saved job creates one
   to-do for that job (never two for the same email).
2. "Not this" on that email removes its open to-do.
3. Cards with open to-dos sort to the top of their column and can be filtered
   to ("Needs you" chip).
4. The user can add, rename, date, complete and delete to-dos from the job
   drawer.
5. Suggested follow-ups (no reply in N days) appear under "Suggested", visibly
   less urgent than real to-dos, and are computed, not stored.
6. Clicking a to-do opens the job drawer: stage, to-dos, emails about this job,
   notes, resume type, links.

### User Story 3 — Email updates you can follow (P1)

The page has three tabs: **To review** (needs a click or an answer), **History**
(everything that was moved, by the app or by the user, and everything dismissed,
for 30 days, each with Undo) and **Other mail** (confirmations, recruiter
messages, not-saved jobs, hidden). A scan runs in the background and reports
real progress.

**Independent test**: approve one update and dismiss another; both are in
History with what happened and an Undo; press Scan and watch the count rise
while using the rest of the app.

**Acceptance**:
1. After "Move to …" or "Not this", the item is in History, never gone.
2. Each History row says what happened ("Moved to Interview automatically",
   "You moved it to Rejected", "You said not this") and links to the card.
3. A scan starts immediately, survives leaving the page, and shows emails
   checked so far; if it stops, the page says what is saved and offers
   **Scan again**.
4. A failed list load shows one message with **Retry**, not a red line on every
   row.
5. "View email" shows the email's text in the app. "Open in Yahoo/Gmail" lands
   on that email (Gmail) or a search narrowed by sender and subject (Yahoo).
6. Hidden and other low-value lists load 50 at a time.

### User Story 4 — Claude Scout says how to start (P2)

The Start view opens with a three-step checklist: resume types (with how many
have a resume), Job Catcher + connector, first search. Each resume type card
has an **Upload resume** button and accepts a dropped file.

**Acceptance**:
1. A first-time user can go from an empty Scout tab to a copied prompt without
   opening an Edit dialog.
2. Uploading on a card attaches the file to that type in one step; cancelling
   leaves no stray file.
3. Each resume type offers a one-click starter search.

### User Story 5 — One look and feel (P2)

Navigation has icons and counts; the phone gets a **More** sheet instead of
hiding pages in Settings; every page uses the same header, empty state, error
state and loading skeleton; fonts and an accent colour are actually loaded;
`Ctrl/⌘+K` finds any job or page.

### Edge cases

- The server restarts mid-scan → status shows "stopped", progress so far is
  kept, Scan again continues.
- A move succeeds on the server but the reply is lost → the next refresh shows
  the true stage; no duplicate move.
- 0 saved jobs → the board shows one empty state with "Find jobs", not eight
  empty columns.
- Reduced-motion setting → no lift, pulse or slide animations.
- Search with no matches → "No jobs match", with a Clear button.

## Requirements

- **FR-001** Board layout: viewport-height board, per-column scroll, sticky
  column headers, collapsible empty stages, incremental rendering (30 at a time).
- **FR-002** Moving: drop anywhere in a column; "Move to…" menu; keyboard and
  touch dragging; failure feedback with Retry.
- **FR-003** Search and filters shared by List and Board: text (title, company),
  Needs you, Remote, resume type, stale. `/` focuses search.
- **FR-004** To-dos: stored per saved job; created from interview / assessment /
  offer emails; manual add/edit/complete/delete; counts in nav.
- **FR-005** Job drawer: one place for a job's stage, to-dos, emails, notes,
  resume type and links, opened from a card, a to-do or an email update.
- **FR-006** Email updates tabs (To review · History · Other mail), History with
  Undo for 30 days, paged lists.
- **FR-007** Background scan with server-side progress and a clear stopped state.
- **FR-008** Mail link: Gmail exact message; Yahoo/AOL search by sender + subject.
- **FR-009** Scout: setup checklist, upload on the resume type card (atomic),
  starter searches.
- **FR-010** Shared UI kit: page header, empty / error / loading states, toasts,
  tooltip, sheet; fonts and colour tokens; nav icons and counts; phone More
  sheet; command palette.
- **FR-011** Every failure a user can hit says what happened and offers the
  next step. No silent rollbacks.
- **FR-012** Accessibility: keyboard reachable, visible focus, WCAG 2.1 AA
  contrast, a non-drag alternative for every drag action, reduced motion
  honoured.

## Success Criteria

- **SC-001** With 200 saved jobs the board needs no page scroll at 1366×768 and
  a card can be found by name in under 5 seconds.
- **SC-002** 10 of 10 drops onto a populated column move the card.
- **SC-003** A failed action never ends without a visible message.
- **SC-004** From any screen, the user can see how many things need them and
  reach the list in one click.
- **SC-005** An acted-on email update is findable for 30 days.
- **SC-006** Board first render under 1 s with 200 jobs on a mid laptop; typing
  in search stays under 100 ms per keystroke.
- **SC-007** A new user reaches a copied Scout prompt in under 2 minutes.

## Out of scope

- Reordering cards inside a column (order is by to-dos, then latest activity).
- Calendar sync or push reminders for to-dos.
- Reading interview dates out of emails automatically (the user sets the date).
- Auto-apply (next feature).
