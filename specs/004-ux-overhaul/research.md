# Research: UX overhaul

## R1. What is actually broken (code audit, 2026-11-19)

| Complaint | Cause found | Where |
|---|---|---|
| "Not letting me move cards" | Every card is also a drop target. With `closestCorners` the drop usually lands on a card id, but `handleDragEnd` only accepts a stage id, so the drop is ignored. It only works on empty space. Failures roll back with no message (no toast library installed). | `frontend/src/components/tracker/KanbanBoard.tsx` `handleDragEnd`; `hooks/useTracker.ts` |
| "Have to scroll down instantly" | Columns have no height limit and no own scroll; the whole page grows to the longest column (183 cards). Nothing is capped or virtualised. | `KanbanBoard.tsx`, `PipelineColumn.tsx` |
| "Can't search here" | The List view filters; the Board has none. | `components/jobs/SavedJobsBody.tsx` |
| "Don't know which ones I have stuff to do for" | No stored "to do" anywhere. The card pill ("Prep for interview") is guessed from the stage name by regex and isn't clickable. `detected_events` knows interview / assessment / offer but the saved-jobs list carries none of it. | `lib/nextAction.ts`, `models/saved_job.py`, `schemas/saved_job.py` |
| "It got it right, then I don't know where it went" | After Move / Not this, the row is dropped on the next refetch: `list_pending` returns only open items plus auto-moved ones. A dismissed item is visible nowhere. | `services/email_review.py` `list_pending` |
| "Couldn't load", "That didn't work", "The scan stopped" | All three are the network-failure fallbacks. During a scan the single worker was busy reading long emails, so every other request timed out and Render restarted the server (fixed separately, PR #12). The scan itself is one long request per pass, so any proxy timeout kills it. | `api/v1/email.py` `scan_inbox`, `hooks/useEmailAccount.ts` `useFullScan` |
| "0 emails read so far" | Progress is counted in the browser only after each whole pass returns. | `components/settings/EmailConnectCard.tsx` |
| "View email doesn't go to the email" | The link is a subject-only webmail search. | `services/email_scan.py` `mail_link` |
| "Not easy to upload a resume" | Upload exists only inside the Edit dialog; cancelling leaves an orphan file. | `components/scout/ResumeTypes.tsx` |
| "Idk how to start this" | Start shows one prompt at a time; nothing lists the steps or the extension/connector prerequisite. | `components/scout/ScoutStart.tsx` |
| "Poorly made" | Fonts never load (`--font-sans: var(--font-sans)` refers to itself); tokens are stock greys; desktop nav has no icons; three pages are only reachable on phone through Settings; each page hand-rolls headers, empty and error states; two `h1`s on My Jobs. | `globals.css`, `routes/DashboardLayout.tsx` |

Also found: saved jobs with no stage never appear on the board; the saved-jobs
list and the email events list are uncapped and refetched on every focus.

## R2. Board layout at volume

**Decision**: a board as tall as the window. Each column scrolls by itself with
a sticky header; the board scrolls sideways. A column renders its first 30
cards and adds 30 more on "Show more" or when its end scrolls into view. Empty
stages collapse to a 44 px rail that still accepts drops.

**Rationale**: users of boards without per-column scroll report losing the
other columns as soon as one grows long
([Kanboard forum](https://kanboard.discourse.group/t/horizontal-scrolling-with-long-columns-is-very-annoying/229),
[SmartSuite request](https://feedback.smartsuite.com/feature-requests/p/scrollbar-for-each-kanban-column)).
The common pattern is fixed headers + column scroll + lazy rendering
([DHTMLX sample](https://dhtmlx.com/docs/products/samples/kanban/fixed-headers-lazy-rendering-xez9ghqq/)).

**Alternatives**: true virtualisation per column (`@tanstack/react-virtual`).
Each scrolling list then needs its own measurement, overscan and drag targeting
([RevoGrid write-up](https://rv-grid.com/blog/virtualized-kanban-board-50000-tasks)),
which is a lot of machinery for a few hundred cards. Incremental rendering needs
no dependency. Revisit past ~1,000 cards in one column. WIP limits: wrong tool,
"Applied" is legitimately long.

## R3. Moving cards

**Decision**: cards are plain draggables and columns are the only drop targets
(`useDraggable` + `useDroppable`, `pointerWithin`), on the installed
`@dnd-kit/core`. Add `TouchSensor` (press-and-hold) and `KeyboardSensor`, and a
"Move to…" menu on every card. Moves stay optimistic; a failure rolls back and
shows a toast with Retry.

**Rationale**: the board never persists an order inside a column, so
`useSortable` only added the bug in R1. A menu is the non-drag alternative
phones and keyboards need. Staying on `@dnd-kit/core` avoids migrating to the
newer `@dnd-kit/react` API mid-overhaul (checked via Context7: the new package
renames sensors and collision helpers).

## R4. "Needs you": stored to-dos, not guesses

**Decision**: a small `job_tasks` table ([data-model.md](data-model.md)). The
app creates a task when an interview, assessment or offer email is matched to a
saved job; the user can add their own. Follow-up nudges stay computed
(`lib/nextAction.ts`) and are shown as "Suggested". The saved-jobs list carries
each job's open tasks so the board needs no extra request.

**Rationale**: trackers people pay for keep tasks and reminders on each job and
surface them outside the board
([Huntr vs Teal](https://huntr.co/blog/huntr-vs-teal),
[Teal: how to track applications](https://help.tealhq.com/en/articles/14435727-how-to-track-your-job-applications),
[Built In tracker](https://builtin.com/articles/built-in-job-tracker-kanban-list)).
A stored task can be ticked off, dated and counted; a guess from the stage name
can't, which is why the current pill reads as noise.

**Alternatives**: flags on `saved_jobs` (one per job, no history, no dates);
deriving everything from `detected_events` (can't be completed, can't be added
by hand).

## R5. Email updates: nothing disappears

**Decision**: three tabs. **To review** = pending + needs-answer. **History** =
auto-moved, user-moved and dismissed, 30 days, each row says what happened and
has Undo and "See the card". **Other mail** = confirmations, recruiter
messages, not-saved, hidden, 50 per page. One banner with Retry for a failed
load; row actions report through toasts; bulk actions are one request.

**Rationale**: the single biggest confusion was an item vanishing after the
user acted on it. An activity log with undo is the standard answer.

## R6. Scan as a background job with real progress

**Decision**: `POST /v1/email/scan/start` starts an in-process asyncio task and
returns at once; `GET /v1/email/scan/status` returns state and counts, stored on
the `email_accounts` row with a heartbeat. The page polls every 2 s while
running. A running state whose heartbeat is older than 90 s reads as "stopped"
(the server restarted); cursors are already saved per folder, so Scan again
continues.

**Rationale**: no request stays open longer than a second, so proxies and cold
starts can't kill a scan, and progress survives leaving the page. No queue or
worker is needed ($0 hosting, one instance). Counts are honest: emails checked,
updates found, cards moved.

**Alternatives**: keep the browser-driven loop (what fails today); server-sent
events (Render's free proxy buffers and drops idle streams); a real job queue
(paid).

## R7. Opening the actual email

**Decision**: the in-app viewer stays the primary "View email" (it shows the
exact message, read-only). The webmail button keeps Gmail's exact-message link
and changes Yahoo/AOL to a search for `from:<sender> subject:"<subject>"`.

**Rationale**: Yahoo documents `From:` and `Subject:` search prefixes
([Yahoo help](https://help.yahoo.com/kb/att/new-mail-for-desktop/search-messages-yahoo-mail-sln28811.html))
but no URL that opens one message. Subject-only search returns many
"Thank you for applying" mails; adding the sender usually leaves one.

**To verify on a real Yahoo account** (quickstart step): that the
`/d/search/keyword=` route accepts the prefixes. If not, fall back to
`"<subject>" <sender-domain>` as plain keywords.

## R8. First-run guidance

**Decision**: a short, persistent checklist at the top of Scout's Start view
(three steps, ticks from real data where possible), plus empty states that name
the next step and carry its button. No product tour.

**Rationale**: guidance that works is a few small tasks with visible progress,
and empty states that invite the next action; click-through tours get dismissed
([Appcues](https://www.appcues.com/blog/user-onboarding-guide),
[Userpilot on progressive disclosure](https://userpilot.com/blog/progressive-disclosure/)).

## R9. Look and feel without new weight

**Decision**: shadcn components the app is missing (sonner toasts, tooltip,
sheet, scroll-area, command); self-hosted Geist via `@fontsource-variable`;
one accent hue plus per-stage colour tokens (already used as column tints);
motion with CSS transitions and `tw-animate-css` only, all behind
`prefers-reduced-motion`.

**Alternatives**: a motion library (framer-motion): ~50 kB for a hover lift, a
pulse and a sheet slide that CSS already does.
