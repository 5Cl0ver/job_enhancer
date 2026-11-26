# Feature Specification: Apply with Claude: one checklist, edit while it fills, problems report

**Feature Branch**: `030-apply-checklist`

**Created**: 2026-11-25

**Status**: Built (2026-11-25)

**Input**: The owner loves the Apply flow and wants it even easier on the eyes: phone first, sleek, short screens, plain words. Three things:
1. Change an answer while Claude is still filling, not only at the review.
2. Claude's questions in one list, with its best guesses filled in, instead of one at a time.
3. Claude reports what went wrong, so the developer can fix it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Change a box while Claude fills (Priority: P1)

In **Filling now**, the user taps a line. A small pop-up offers **Change it to…** (a text box) or **Ask Claude** (a free note), and **Send to Claude**.
- It goes to Claude at once, in its next tool result (the `from_user` it already reads).
- Claude changes the box on the page (going back a page if needed), or answers the question with a message.
- The line shows "→ new answer (sent to Claude)" until the box changes.
- Only the user's own words are the message. The box's label and value come from the web page: they're taken from Job Catcher's live view (a box that isn't on it is refused) and given to Claude apart, marked as page text, never as instructions.
- The review's answer bubbles (spec 026) work as before, with the same page-text rule: the fix note is only the user's words ("Fix 1: Change it to “None”."), and each fix's question and value come from the run's own pages (unknown answers are dropped), given to Claude apart as `box_on_page` / `now_on_page`.

**Acceptance:**
1. Tapping "Prefix: Mr." and sending "None" gives Claude `from_user: [{text, fix: {q: "Prefix", a: "Mr.", to: "None"}}]` with a note saying what to do.
2. When the run isn't filling, the app refuses it ("Claude isn't filling the application right now").

### User Story 2 - Claude's questions as one checklist (Priority: P1)

Claude sends its questions **together**, each with its best guess filled in and up to 4 quick answers. The app shows one neat list:
- Each row: the question, the answer box (Claude's guess in it, editable), quick-answer chips.
- Rows Claude marks **only you can answer** (experience, years with a tool, degrees, sign-ins…) come first and are highlighted; their box is empty unless Claude had a real guess.
- One button: **Looks good, go**. Empty rows are skipped ("1 left empty: Claude skips it.").
- It works before the résumé (the listing's gaps) and while filling (facts a page asks for). After a checklist while filling, Claude goes back to filling.
- Answers are still kept as "things you told Claude", except a guess the user left as it was: it's used for this job only.
- While the checklist is out, Claude can't fill or finish a page (it waits for the answers), and can't send a new checklist over answers it hasn't picked up.
- After the answers, the run goes back to where it was: filling, or writing (a first résumé, or the change the user asked for, then their look again).
- Truly blocking things (sign in, CAPTCHA, a human check, a file) stay single "Claude needs you" cards.

**Acceptance:**
1. A checklist with a guessed "How did you hear about us? LinkedIn" and an only-you "Years of Python?" shows the only-you row first, highlighted and empty, and the guess filled in.
2. Pressing **Looks good, go** sends every row at once; Claude's `wait_for_you` returns the answers and "carry on filling".

### User Story 3 - Problems Claude ran into (Priority: P2)

Claude calls `report_problem` as soon as something goes wrong: a box it couldn't fill, a Job Catcher error, a lost tab, Job Catcher wrongly saying there's no résumé box.
- The application page shows them in a closed **Problems Claude ran into (N)** section.
- The admin page lists everyone's, newest first, with the job and who, so the developer can fix them.

**Acceptance:**
1. A reported problem shows on the run, with its kind, time, page and how many times.
2. Only the admin sees the list across runs; a regular user gets 403.

### User Story 4 - Bug reports for the developer (Priority: P2)

The owner asked for "auto bug reports that Claude finds, so I can feed them back to you, in a dedicated section of the admin dashboard".

- The admin page has a **Bug reports** section: grouped by kind (Job Catcher, Résumé, Lost tab, Site, A box it couldn't fill, Other), newest first, with counts.
- Each report keeps its context, stored with it: run, job (title and company), site, page (no query), Job Catcher version, playbook version, time.
- Each has a status: open, fixed or ignored. **Fixed** and **Ignore** buttons (and **Open again**). Open ones show by default; a toggle shows all. The same problem again is open again.
- **Copy for Claude** copies one report as Markdown ("# Bug report: Job Catcher on northwind.example", Run / Job / Site / Job Catcher / Playbook / When, "## What happened", "## Page"); **Copy all open** copies every open one under one heading with a count. "Copied" shows; if the clipboard is blocked, a box with the text appears to copy by hand.

**Acceptance:**
1. Marking a report Fixed hides it from the open list; a wrong id is a 404; a regular user gets 403.
2. Copy all open gives "# Open bug reports (2)" and both reports.

### Edge Cases

- **The same problem twice**: counted ("2 times"), not repeated.
- **More than 20 problems** in a run: the rest aren't kept; Claude is told and carries on.
- **A password or code in a problem**: removed before it's kept ("password: [removed]", "password hunter2", "code 482913"); emails, phone, card and SSN numbers and long key blobs too. The page is kept without its query; its path (job slugs like Senior-Engineer_R0012345) stays.
- **A fix for a box on a page Claude already left**: Claude goes back to it, or the user fixes it at the review.
- **Many fixes Claude hasn't read**: at most 30 waiting; then "Claude hasn't read your last changes yet".
- **A chat answer** already saved is never sent back as skipped.

## Requirements *(mandatory)*

- **FR-001**: `POST /v1/apply/runs/{id}/live-fix` (owner only) takes `{q, a, to | ask}` while the run is filling or waiting on help, and adds it to the conversation as an unread message with `fix`.
- **FR-002**: Every connector result that carries `from_user` keeps each item's `fix` and adds a line saying what to do with it.
- **FR-003**: `ask_questions` takes `guess`, `choices` (≤4), `only_you` per question; ≤12 at once, ≤30 a run; allowed while reading, writing or filling; each call starts or joins a checklist (`batch`).
- **FR-004**: After a checklist asked while filling, `wait_for_you` returns that checklist's answers and sends Claude back to filling.
- **FR-005**: The app shows the newest checklist only, only-you first, with **Looks good, go**.
- **FR-006**: `report_problem(run_id, what, page_url?, kind?)`: kind in fill / job_catcher / tab / resume / site / other (else other); ≤500 chars; ≤20 a run; secrets removed; page without query.
- **FR-007**: The run view carries `problems`; `GET /v1/admin/apply-problems` (admin only) lists them across runs (last 60 days), reading only the columns it needs; `PATCH /v1/admin/apply-problems/{run_id}/{id}` (admin only) sets open / fixed / ignored.
- **FR-009**: Each problem is stored with a short id and its context (run, job, site, Job Catcher and playbook versions); the admin's Bug reports group, filter, mark and copy them as Markdown.
- **FR-008**: The playbook tells Claude to batch questions with best guesses, apply mid-fill changes, keep blocking things as help, and report problems; version 2026.11.30.

## Success Criteria

- **SC-001**: Claude asks its questions in one go, not one at a time.
- **SC-002**: A change made while filling reaches Claude in its next call (seconds).
- **SC-003**: The developer can see every problem Claude hit, in one list.
