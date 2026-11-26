# Feature Specification: Bug inbox: every bug and idea, in one organized place

**Feature Branch**: `032-bug-inbox`

**Created**: 2026-11-25

**Status**: Draft

**Input**: The owner asked: "is the bug report section set up in our app? for any and every bug, me, AI reporting etc??? organize megaaa, organize even ideas I can't think of". Today the admin **Bug reports** section (spec 030) only shows problems Claude reports during an Apply with Claude run. Nothing else feeds it, and the owner can't add anything. They want one inbox, fed by every source, organized so it's easy to see everything and easy to hand to Claude to fix.

## How it fits together

- **One inbox**, owner-only, inside Admin. It holds **bugs** and **ideas**.
- **Four ways in:**
  1. **The owner**, with an "Add a bug or idea" button on every page (phone too).
  2. **The owner's AI** (Claude or any AI using the connector), from any chat.
  3. **Claude during an Apply with Claude run** (what spec 030 already collects).
  4. **The app itself**, which catches its own errors.
- **One format** for every report, so they all look and sort the same.
- **Organized:** grouped by section, filtered, searched, repeats merged, priority worked out for you, and statuses that follow a bug from "new" to "fixed".
- **Out to Claude:** "Copy for Claude" for one report or a whole list, plus connector tools so Claude can read the inbox and mark things fixed itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every bug and idea in one place (Priority: P1)

The owner opens **Admin → Inbox** and sees everything, newest and most important first.
- **Tabs:** **Bugs** and **Ideas**, each with a count.
- **Sections:** App, Job Catcher, Email updates, Scout, Apply with Claude, Account & other. Each shows its own count, and tapping one filters to it.
- **Each row:** title, section, severity, status, where it came from (You / Your AI / Claude in a run / Caught by the app), how many times it happened, and when it was last seen.
- **Filters:** status, severity, source, "came back", and "needs your check". A **search** box looks through titles, where, and text.
- **Default view:** open bugs (new, confirmed, working on it), highest priority first.
- **Tap a row** to open the whole report: every field, screenshot, notes, the times it happened, linked reports, and the history of status changes.
- **Phone:** the same inbox works on a phone as a list with a filter sheet. Nothing is hidden.

**Why this priority**: without one place to see everything, nothing else matters.

**Independent Test**: Seed reports from each source, open the inbox on a computer and a phone, and check that grouping, counts, filters, search and the detail view are all right.

**Acceptance Scenarios**:

1. **Given** 3 Job Catcher bugs and 2 Email bugs, **When** the owner taps "Job Catcher", **Then** only those 3 show, and the section reads "3".
2. **Given** a blocker seen 5 times and a minor seen once, **When** the inbox opens, **Then** the blocker is listed first.
3. **Given** a signed-in user who isn't the owner, **When** they go to the inbox address or use its data, **Then** they are refused and see nothing.

---

### User Story 2 - Add a bug or idea from anywhere (Priority: P1)

On every page, the owner has a small **"Add a bug or idea"** button, on the desktop sidebar and in the phone's top bar. It opens a short form:
- **Bug or idea** (a toggle).
- **Title** (required).
- **What happened**, with **What you expected** for bugs, or **The idea** for ideas.
- **Steps** (optional, numbered lines).
- **Section**, guessed from the current page; the owner can change it.
- **Severity**: blocker, major or minor. Bugs only, default major.
- **Screenshot** (optional): choose a file or take a photo on a phone.
- These are **filled in automatically** and shown, so the owner can see them: the current page, device (phone or computer), browser, light or dark, the app's version, Job Catcher's version (if connected), and the time.
- **Save** adds it straight to the inbox and shows "Added". The owner stays on their page.
- Saving can't lose what was typed. If saving fails, the form keeps the text and says so.

**Why this priority**: the owner finds bugs while using the app, and needs to note them in seconds without leaving the page.

**Independent Test**: From the My Jobs page on a phone, add a bug with a photo and check it appears in the inbox with section App, the right page, phone, and the photo.

**Acceptance Scenarios**:

1. **Given** the owner is on Email Updates, **When** they open the form, **Then** the section is "Email updates" and the page is filled in.
2. **Given** an idea, **When** it is saved, **Then** it shows under Ideas with status "New", and with no severity.
3. **Given** a user who isn't the owner, **When** any page loads, **Then** no "Add a bug or idea" button appears.

---

### User Story 3 - The app catches its own problems (Priority: P1)

Problems the app can see for itself go into the inbox with no one writing them up:
- **Server errors**: a request that fails unexpectedly, recorded with the page or action and the error type.
- **App crashes**: a page that breaks in the browser. The user sees a friendly "Something went wrong, reload", and the crash is reported.
- **Job Catcher errors**: a save, fill or attach that fails, recorded with the site and Job Catcher's version.
- **Email check failures**: a mailbox check that keeps failing.
- **Scout run failures**: a run that ends with an error.
- **Outside services down**: a service on the Admin health list that is down, reported once per outage.
- Each is marked **"Caught by the app"**, gets a plain title ("Server error on Save job"), a section, and severity **major**, which the owner can change.
- The **same problem merges** into one report with a count, first seen and last seen. It never floods the inbox.
- Nothing private is kept: no passwords, codes, emails, phone or card numbers, mail text, or job text. Only where it happened, the kind of error, and versions.

**Why this priority**: the owner can't report what they never see. Most bugs show up as errors first.

**Independent Test**: Force a server error, a browser crash, a Job Catcher save failure, and a failing mailbox check (in tests), and check each appears once with the right section, then counts up when repeated.

**Acceptance Scenarios**:

1. **Given** the same server error happens 40 times in an hour, **When** the owner opens the inbox, **Then** there is one report "seen 40 times" with the first and last time.
2. **Given** an error message that contains an email address, **When** it is recorded, **Then** the email shows as "[removed]".
3. **Given** a friend's account hits a server error, **When** it is recorded, **Then** the report says "a user", with no name or email, and has no data from their jobs.

---

### User Story 4 - Repeats merge, fixed bugs that come back reopen (Priority: P1)

- **Same problem, one report.** Reports caught by the app or by Claude merge automatically when they are clearly the same: same section, same kind, same place.
- **Possible repeats.** For reports the owner or their AI writes, the app suggests "Looks like: [other report]", and one tap merges them. The texts are kept, and the count goes up.
- **It came back.** If a merged repeat arrives after a report was marked **fixed**, the report goes back to **new** and is flagged **"Came back"**, with the date it came back and the version it was fixed in.
- **Priority** is worked out for the owner: blocker first, then major, then minor. Within each level, more repeats and more recent ones come first, and "came back" bugs move to the top of their level. The owner can **pin** a report to keep it at the top.

**Why this priority**: an inbox full of copies is useless, and a fix that didn't hold must not stay hidden.

**Independent Test**: Mark a caught error fixed, trigger it again, and check that it reopens, flagged "Came back", and sorts to the top of its severity.

**Acceptance Scenarios**:

1. **Given** report A is fixed in "Job Catcher 0.45.0", **When** the same error arrives again, **Then** A is "new", shows "Came back after the 0.45.0 fix", and no second report is made.
2. **Given** the owner adds "Phone in extension box" while a report "Phone put in Phone Extension" exists, **When** they save, **Then** the app offers "Looks like: Phone put in Phone Extension", and merging adds 1 to its count.

---

### User Story 5 - Move bugs and ideas along (Priority: P1)

- **Bug statuses:** new → confirmed → working on it → fixed, or won't fix.
- **Idea statuses:** new → planned → done, or no.
- **Fixed** asks, optionally, "Fixed in which version?" (a short text like "Job Catcher 0.45.0" or "PR #70").
- When Claude marks something fixed, it shows **"Fixed by Claude: needs your check"** until the owner confirms it with **Looks fixed**, or reopens it.
- **Notes:** the owner can add short notes to any report, and each note is dated.
- **Links:** "related to" another report, both ways. An idea can link to the bugs it would solve.
- **Edit:** the owner can fix any field, such as the title, section or severity, or turn a bug into an idea and back.
- **Delete:** delete a report for good, after a confirm. For example, test junk.
- **Many at once:** select several rows, then change their status or section, or copy them.
- **History:** every status change is kept with who made it (You or Claude) and when.

**Why this priority**: seeing bugs is only useful if they can be tracked to done.

**Independent Test**: Take a bug through every status, add a note and a link, bulk-mark 3 as won't fix, and check the history shows each step.

**Acceptance Scenarios**:

1. **Given** a new bug, **When** the owner marks it fixed with "PR #70", **Then** it leaves the open view and shows "Fixed in PR #70" in its detail.
2. **Given** an idea, **When** the owner turns it into a bug, **Then** it gets a bug status (new) and a severity (major), and its text is kept.

---

### User Story 6 - Hand it to Claude without copy-paste mess (Priority: P2)

- **Copy for Claude**, on one report or on the current filtered list ("Copy 7 for Claude"). It makes one clean block per report in the fixed format, numbered, with a short header.
- Text from web pages or from users (labels, page words, error text) is fenced off and marked as data, never instructions.
- **Connector tools for the owner's AI** (owner-only; anyone else is refused):
  - **List reports**: by tab, section, status or severity; open bugs by default; highest priority first.
  - **Read a report**: all its fields, notes, how many times it happened, and its history.
  - **Update a report**: status, a note, the fixed-in version, a severity or section change. Fixed by Claude always lands as "needs your check".
  - **Add a report**: in the fixed format, from any chat, not just during a run. Repeats suggested or merged as in User Story 4.
- Claude's words are capped and scrubbed the same way the owner's are.

**Why this priority**: the whole point is getting bugs fixed. Once the inbox exists, this saves the most time.

**Independent Test**: Filter to open Job Catcher bugs, copy for Claude, and check the text. Then, through the connector as the owner, list, read, mark one fixed, and add one. As another user, check each call is refused.

**Acceptance Scenarios**:

1. **Given** 3 open Workday bugs, **When** the owner presses "Copy 3 for Claude", **Then** the clipboard holds 3 numbered reports, each with title, section, where, steps, expected, actual, severity, count, versions, and page text fenced.
2. **Given** Claude marks a bug fixed through the connector, **When** the owner opens it, **Then** it says "Fixed by Claude: needs your check" with Claude's note.

---

### User Story 7 - Claude's apply-run problems live here too (Priority: P2)

- Every problem Claude reports during an Apply with Claude run (spec 030) also becomes an inbox report, in section **Apply with Claude**, or **Job Catcher** when its kind is a Job Catcher one. It keeps a link to the run and the job.
- Problems already saved from past runs are brought in once, with their status kept: open → new, fixed → fixed, ignored → won't fix.
- The run page still shows its own problems to the person running it, exactly as today.
- The old Bug reports card in Admin is replaced by the inbox. Nothing it did is lost.

**Why this priority**: the source that already works must not live in a separate list.

**Independent Test**: Report a problem in a test run and check it appears in the inbox linked to the run, while the run page still shows it. Check that the old problems were brought in with the right statuses.

**Acceptance Scenarios**:

1. **Given** a past run problem marked "ignored", **When** the inbox first loads after the update, **Then** it is there as "won't fix", linked to its run.

---

### User Story 8 - Report from Job Catcher (Priority: P3)

- In Job Catcher's side panel, the owner has a **"Report a problem here"** link. It sends a bug with the **current site and page**, Job Catcher's version, and an optional short note, plus a picture of the visible page if the owner ticks "Add a picture".
- It lands in section **Job Catcher**.
- People who aren't the owner don't see the link.

**Why this priority**: many bugs happen on job sites, away from the app. Useful, but the app button covers the basics.

**Independent Test**: With the owner signed in on Job Catcher, report from a test page and check the inbox has the site, the version and the picture.

**Acceptance Scenarios**:

1. **Given** the owner on a Workday page, **When** they send "résumé didn't attach", **Then** the inbox has a Job Catcher bug with the site, the page without its query string, the version and the note.

---

### User Story 9 - Starting entries (Priority: P3)

When the inbox first appears, it already holds what's been noted so far:
1. **Bug, Apply with Claude, major:** "Claude stops at random after starting from a job listing page." The owner pasted the start line while on the job listing; Claude moved to the right page, then the app said it had stopped and it had to be restarted by hand.
2. **Bug, Job Catcher, major:** "The app doesn't make it obvious when Job Catcher is out of date." A computer stayed on 0.42.0 while 0.44.0 was out, so fixed bugs kept happening; only a small "hasn't checked in lately" line showed.
3. **Idea, Apply with Claude:** "Fill everything, fix at the end." One growing list of every field across all pages. Taps on a field are saved as fixes for later instead of being sent to Claude mid-fill. Two modes: Page by page (the default, pause after each page, then Continue) and Keep going. Claude uses its best judgment on unknown required fields and marks them. The owner reviews everything at the end, then Claude applies the fixes.

4. **Idea, Apply with Claude:** "Show the form's real choices when I change an answer." When the owner taps a dropdown or radio question (for example veteran status) to change it, the pop-up shows a free text box. It should show the choices the form itself offers, to pick from.

5. **Bug, Apply with Claude, major:** "The final review repeats the same questions." The review page lists the same question more than once (for example veteran status under Page 4 and again under Page 5), which makes it confusing. Each question should show once, with its latest answer.

**Independent Test**: A fresh inbox shows exactly these 5 entries, from "You", and they're added only once.

### Edge Cases

- **Not the owner:** no button, no inbox, no connector access. Every attempt is refused, with nothing leaked.
- **A flood of errors** (a broken release): one report per kind and place, with the count going up. New caught reports are capped per hour, and once the cap is hit, one "Too many errors, X more not kept" report is made.
- **A huge or odd screenshot:** big photos are shrunk first; anything that isn't an image, or is still too big, is refused with a plain message.
- **A report deleted while Claude reads it:** Claude gets "not found".
- **Two changes at once** (the owner and Claude): the last change wins, and both show in the history.
- **Secrets in text:** passwords, codes, emails, phone, card and SSN numbers and long key strings are removed before saving, from every source.
- **Page text trying to give orders** ("ignore your instructions…"): it's kept only as fenced data and never treated as instructions when copied or read by Claude.
- **Offline or saving fails:** the owner's typed report is kept in the form, with "Couldn't save, try again".
- **Merged by mistake:** a merge can be undone from the report, and the pieces split back.
- **Auto-caught errors from the inbox itself:** they can't loop forever. An error while saving a caught report is never itself reported.
- **Old run problems with missing jobs or runs:** they're still brought in, without the link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep one inbox of reports, each either a **bug** or an **idea**, visible and changeable only by the owner (admin).
- **FR-002**: Every report MUST use one format: title, type, section (App, Job Catcher, Email updates, Scout, Apply with Claude, Account & other), where (page, site, box), steps, what happened, what was expected (bugs) or the idea (ideas), severity (bugs: blocker, major, minor), confidence (sure, not sure), device, browser and theme, app and Job Catcher versions, an optional screenshot, source, and the reporting time.
- **FR-003**: Reports MUST record their source: You, Your AI (connector), Claude in a run, or Caught by the app. Caught reports from other users MUST NOT include who they were.
- **FR-004**: The owner MUST be able to add a bug or idea from every page on computer and phone, with page, device, browser, theme, versions and time filled in automatically, the section guessed from the page, and an optional screenshot.
- **FR-005**: The system MUST record, as caught reports: unexpected server errors, browser crashes, Job Catcher save, fill and attach failures, repeated mailbox check failures, failed Scout runs, and outside-service outages from the health list (once per outage).
- **FR-006**: Caught and Claude-run reports that match an existing report by section, kind and place MUST merge into it, raising its count and updating last seen. Other reports MUST get repeat suggestions that the owner can accept with one tap. Merges MUST be undoable.
- **FR-007**: A merged repeat arriving for a report marked fixed MUST reopen it as new, flagged "came back", with the date and the fixed-in version shown.
- **FR-008**: The inbox MUST order reports by worked-out priority: pinned, then severity, with "came back" first within its level, then repeat count, then last seen.
- **FR-009**: Bugs MUST move through new, confirmed, working on it, fixed, won't fix. Ideas MUST move through new, planned, done, no. Every change MUST be kept in a history with who (owner or Claude) and when.
- **FR-010**: A fix MUST optionally take a fixed-in version. A fix made by Claude MUST show "needs your check" until the owner confirms it or reopens it.
- **FR-011**: The owner MUST be able to add dated notes, link reports both ways, edit any field, switch bug and idea, delete with a confirm, and change several reports at once (status, section, copy).
- **FR-012**: The inbox MUST offer Bugs and Ideas tabs, section groups with counts, filters (status, severity, source, came back, needs your check), and search across title, where and text. It MUST work fully on a phone.
- **FR-013**: "Copy for Claude" MUST produce clean numbered reports in the fixed format for one report or the whole filtered list, with page and user text fenced and labeled as data.
- **FR-014**: The connector MUST offer owner-only tools to list, read, update and add reports, with the same caps, scrubbing, merging and history as the app. Anyone else MUST be refused.
- **FR-015**: Problems Claude reports in Apply with Claude runs MUST also become inbox reports linked to their run and job. Past ones MUST be brought in once, with status mapped (open → new, fixed → fixed, ignored → won't fix). The run page MUST keep showing them as today.
- **FR-016**: Job Catcher MUST let the owner report a problem from the current site, with the site and page (no query string), its version, a note, and an optional picture of the visible page.
- **FR-017**: The inbox MUST start with the 5 entries listed in User Story 9, added only once.
- **FR-018**: All text from every source MUST be capped in length, and passwords, codes, emails, phone, card and SSN numbers and long key strings MUST be removed before saving. Page text MUST never be treated as instructions.
- **FR-019**: New caught reports MUST be capped per hour, with one summary report when the cap is hit. Failures while saving a caught report MUST NOT be reported again.
- **FR-020**: The Admin menu item MUST show the number of new bugs for the owner. Nothing else in the app changes for other users.

### Key Entities

- **Report**: one bug or idea. It holds the fixed-format fields, plus status, priority inputs (severity, pinned, count, first and last seen, came back), the fixed-in version, "needs your check", source, and links to a run or job when there is one.
- **Occurrence**: one time a report happened, merged in, with when, where, versions and device. Recent ones are kept for the detail view.
- **Note**: dated text on a report, by the owner or Claude.
- **Link**: "related to" between two reports.
- **History entry**: a change to a report (status, field, merge, split), with who and when.
- **Screenshot**: an image attached to a report, only viewable by the owner.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can add a bug from any page, on phone or computer, in under 30 seconds, without leaving the page.
- **SC-002**: 100% of problems from all four sources show up in the inbox. None live only in another list.
- **SC-003**: The same problem repeated 100 times shows as 1 report with a count of 100.
- **SC-004**: A bug that comes back after being marked fixed is at the top of its severity within one minute of happening again.
- **SC-005**: The owner can find any report in under 10 seconds with a section, filter or search.
- **SC-006**: Copying 10 reports for Claude takes one press, and the text needs no editing before pasting.
- **SC-007**: No password, code, email, phone, card or SSN number is ever stored in a report (checked by tests with planted examples).
- **SC-008**: Non-owners can't see or change anything in the inbox, by any route (tested).

## Assumptions

- **Owner-only for now.** Friends don't get the inbox or the button. Their app errors are still caught, without who they were. Later this could open to everyone as a "Send feedback" feature.
- **Claude's apply-run reporting stays as it is** for every user (spec 030). It just also feeds the inbox.
- **No AI is used** to sort, merge or title anything. Merging uses plain matching (section, kind, place, similar titles).
- **Screenshots** are images (a phone photo is fine). The app shrinks them before saving, stores them privately, and shows them only to the owner. A report's screenshots are deleted with the report.
- **Kept until deleted.** Reports stay until the owner deletes them. Each report keeps its most recent 20 occurrences in detail, and the count covers them all.
- **Outside-service outages** reuse the Admin health checks that already run.
- **"Versions"** means the app's release and Job Catcher's version, both of which the app already knows.
- **The old Bug reports card is replaced**, not kept alongside, so there's one place.
