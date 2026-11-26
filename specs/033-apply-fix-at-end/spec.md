# Feature Specification: Apply with Claude: see everything, fix at the end

**Feature Branch**: `033-apply-fix-at-end`

**Created**: 2026-11-25

**Status**: Draft

**Input**: The owner's notes from real runs on 2026-11-25:
- **"Filling now" resets every page.** It showed "1 of 1 filled". It should keep growing as Claude fills, on every page.
- **Tapping a box sends the change to Claude straight away**, which interrupts Claude mid-fill and causes problems. Changes should wait, and Claude fixes them at the end. There are two modes: **Page by page** (the default) and **Keep going**. Claude uses its best judgment and marks its guesses; the owner reviews everything at the end.
- **The change pop-up shows a free text box** even for a dropdown or radio question, like veteran status. It should show the form's real choices.
- **The final review repeats the same question**, for example veteran status under Page 4 and Page 5, which makes it confusing.
- **Claude stops at random**: the app says it stopped, and the owner has to restart it by hand.
- **Claude reported a "Contoso / Northwind mix-up"**: the application site belonged to a different company name than the saved job.

## Root causes found in the code

- **"Filling now" is a live snapshot** of only the form on screen, replaced every 3 seconds. Nothing is kept per page, and a pop-up or a one-question step reads "1 of 1".
- **A tapped fix is sent at once.** It's refused if the box isn't on the current page. The playbook then tells Claude to go back and finish that page again, which adds a **second copy of the page**. The review never merges copies within a round, so questions show twice. Workday keeping one address for every step makes it worse.
- **The form's choices are known to Job Catcher** but thrown away before they reach the app.
- **"Claude seems to have stopped" fires after 3 minutes without a connector call**, even while Claude is busy clicking in Chrome. Some refusals (for example "can't do that while your checklist is open") end Claude's turn. Long Job Catcher fills can pass the 45-second wait.
- **Nothing compares the application site's company with the saved job's company.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One growing list of everything Claude fills (Priority: P1)

The **Filling now** card becomes **Your application**: one list that keeps growing for the whole run.
- **Grouped by step**, using the site's own step names when it has them (Workday: My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review). Otherwise "Page 1", "Page 2"… The step being filled is open; finished steps fold to one line ("My Information · 14 filled · 2 to check"), and a tap opens them.
- **Every box shows once:** the question, the answer, and a small tag: Claude guessed, From your profile, You changed it, Left empty, Only you can answer.
- **A header** reads, for example, "Filling My Experience · 31 filled · 3 to check · 2 fixes waiting", with the mode next to it.
- If the site goes back to an earlier step, that step's rows update in place. Nothing is ever added twice.
- It still updates live (a few seconds behind), on the phone and the computer, and survives reloads.

**Acceptance:**
1. **Given** Claude has filled 3 Workday steps, **When** the owner opens the run, **Then** they see all 3 steps' boxes, grouped, with correct counts, not "1 of 1".
2. **Given** a date picker pop-up is open on the page, **When** the list updates, **Then** earlier rows stay and the counts don't drop.

### User Story 2 - Changes wait, Claude fixes at the right time (Priority: P1)

- Tapping **any** row, on any step, opens a sheet. **Change it to** shows the box's real choices when it has them (see Story 3), otherwise a text box. **Ask Claude about it** is a note. The button is **Add fix**.
- Added fixes are **kept on the run**, so they survive a reload or a switch from phone to computer. A tray shows "2 fixes waiting", and each can be edited or removed. The row shows "→ No (waiting)".
- **When fixes reach Claude:**
  - **Page by page** (default): when the owner presses **Continue** after a step (Story 4).
  - **Keep going**: at the end, when Claude finishes the last step and before the review.
  - Either way, Claude goes back to the right steps, makes the changes, and the rows show "→ No (done)".
- There's a **Send now** link in the tray for the rare urgent case. It's small, not the default.

**Acceptance:**
1. **Given** Keep going mode on step 3, **When** the owner adds a fix to a step-1 box, **Then** nothing is sent to Claude yet, the tray shows "1 fix waiting", and after the last step Claude applies it and the row shows done.
2. **Given** a waiting fix, **When** the owner reloads on their phone, **Then** it's still there.

### User Story 3 - The form's real choices (Priority: P1)

For a dropdown, radio, or checkbox group, the sheet lists the choices the form itself shows, with the current one highlighted. Tap one to choose it. Long lists get a search box. "Something else" opens a text box only when the form allows typing.

**Acceptance:**
1. **Given** "Please select your veteran status" with 4 choices on the page, **When** the owner taps it, **Then** they see those 4 choices as buttons, not a text box.

### User Story 4 - Two modes (Priority: P1)

- **Choose at the start, change any time** from the run page: **Page by page** (the default) or **Keep going**.
- **Page by page:** after each step, Claude pauses. The app shows "My Information is done: look it over", with that step's rows open, the waiting fixes for it, and **Continue**. Continue sends that step's fixes. Claude makes them, then moves on.
- **Keep going:** Claude fills every step without stopping, using its best judgment on anything it doesn't know, and marks those answers "Claude guessed". At the end it applies all waiting fixes, then the review opens.
- **In both modes**, truly blocking things still stop for you: sign in, a CAPTCHA, a file to attach, a question only you can answer that the form won't let past. And Claude never presses the final Submit.

**Acceptance:**
1. **Given** Page by page, **When** Claude finishes step 1, **Then** it waits for Continue, and the app shows the step check.
2. **Given** Keep going, **When** a required question has no known answer, **Then** Claude picks its best answer, marks it guessed, and goes on.

### User Story 5 - A clean final review (Priority: P1)

- The review is built from the same one list: **one row per question**, with its latest answer, grouped by step. **Check these first** lists only guesses, empties and "only you" rows, each once.
- Fixes added in the review join the same waiting tray, and **Send fixes** works as today.

**Acceptance:**
1. **Given** Claude finished a step twice (after a fix), **When** the review opens, **Then** each question shows once, under its step, with the newest answer.

### User Story 6 - Claude doesn't stop at random (Priority: P1)

- **"Claude seems to have stopped"** only shows when Claude has truly gone quiet. Job Catcher seeing the page change counts as Claude working, and the wait before warning is longer while filling.
- **Refusals don't end Claude's turn.** Every "not now" answer tells Claude exactly what to do next, for example "wait_for_you", instead of failing.
- **Starting from a job listing page works:** Claude is told to open the application in the same tab, and the run follows it to the company's application site.
- **Slow fills get more time** before Job Catcher's answer counts as missing, and a missed answer is retried once before Claude is told.
- **If Claude does stop**, the app's message is clear and the carry-on line picks up exactly where it left off, keeping the waiting fixes.

**Acceptance:**
1. **Given** Claude is clicking through a long Workday page for 4 minutes with no connector call, **When** the owner looks, **Then** no "stopped" warning shows while the page keeps changing.
2. **Given** Claude calls fill while the checklist is open, **When** it is refused, **Then** the answer tells it to wait for the checklist, and the run carries on.

### User Story 7 - The right company (Priority: P2)

When the application site shows a different company name from the saved job (an agency, a parent company, or a different employer), Claude says so in the conversation ("This application is on Acme's site; your saved job says Beta Corp. I'll treat Acme as the employer for 'why us' answers unless you say otherwise"). It notes it as a problem, and uses the employer the page shows for company-specific answers. The owner can reply to change that.

**Acceptance:**
1. **Given** a saved job for "Beta" whose application page says "Acme", **When** Claude reaches the form, **Then** the conversation shows the note and a problem is reported.

### Edge Cases

- **The site renames a step** (Workday adds a step mid-way): the list keeps the old rows and adds the new step.
- **One address for every step:** steps come from the site's step label or heading, not the address.
- **A fix for a box that no longer exists:** Claude says so and the fix shows "couldn't apply: box gone".
- **Choices that change after another answer** (country, then state): the sheet shows the choices as last seen, and Claude handles the dependency.
- **Switching mode mid-run:** to Keep going, Claude carries on with no more pauses. To Page by page, Claude pauses at the next step's end.
- **Sensitive questions** (self-ID, consent, passwords): never filled by guessing; shown as "Only you" with their real choices.
- **Many fixes** (30 or more waiting): the tray says "30 fixes, the most at once", and more can be added after they're sent.

## Requirements *(mandatory)*

- **FR-001**: The run MUST keep one merged sheet of every box Claude or Job Catcher filled, keyed by step and question, with the latest answer, its choices (when the form has them), and its tag. The sheet MUST update from Job Catcher's live view and from each finished page, and MUST never hold the same question twice in one step.
- **FR-002**: Steps MUST come from the site's step label or heading when present, else page order. The app MUST group the sheet by step, with counts.
- **FR-003**: Fixes MUST be stored on the run as waiting until delivered. They're delivered on Continue (Page by page), at the end (Keep going), or on Send now. Each fix shows waiting, sent, done, or couldn't apply.
- **FR-004**: Job Catcher MUST send the choices (labels only) of dropdowns, radio groups and checkbox groups, up to 60 per box, each up to 120 characters. The fix sheet MUST show them as choices.
- **FR-005**: The run MUST have a mode, Page by page (default) or Keep going, set at start and changeable any time. Page by page MUST pause after each finished step until Continue.
- **FR-006**: The review MUST be built from the merged sheet: one row per question per step, plus a deduped "Check these first".
- **FR-007**: "Claude stopped" MUST count Job Catcher's page changes as activity and wait longer while filling. Refusals MUST return a `next` instruction instead of failing. A missing Job Catcher answer MUST be retried once.
- **FR-008**: The playbook MUST teach modes, waiting fixes, one tab, best judgment with marks, and the company check, and MUST never say to finish the same page again just to apply a fix.
- **FR-009**: Claude MUST say when the application site's company differs from the saved job, and report it.
- **FR-010**: Everything here MUST keep the existing safety: page text is data only, no final Submit, the sensitive-question rules, and owner-only routes.

## Success Criteria *(mandatory)*

- **SC-001**: In a 6-step Workday run, the owner can see every filled box from every step at any time.
- **SC-002**: The review never shows the same question twice in a step (tested with redone pages).
- **SC-003**: Every dropdown or radio question in the sheet offers its real choices.
- **SC-004**: No "stopped" warning while Claude is actively filling (tested with 5 minutes of page changes and no connector calls).
- **SC-005**: In Keep going mode, a full application finishes with zero pauses except true blockers.

## Assumptions

- **Job Catcher needs a new version** (choices and step names). Older versions still work, without choices: the sheet falls back to a text box.
- **The mode defaults to Page by page** for every new run (owner's decision, 2026-11-25).
- **Best judgment is always on;** guesses are always marked, never hidden.
