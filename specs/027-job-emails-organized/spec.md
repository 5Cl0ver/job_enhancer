# Feature Specification: Every email about a job, kept and organized

**Feature Branch**: `027-job-emails-organized`

**Created**: 2026-11-25

**Status**: Plan only. The owner decides before anything is built.

**Input**: The owner, 2026-11-25:
> "I think the email Yahoo finder is not working again, because there are some job updates that I had that it's not detecting… I rely on this for my emails."
>
> "So have like email updates for every email related to that job, right? I can be able to have sections in the job section and emails organized nicely, if available and easy to do and accurate."

**What the investigation found** (read only, 2026-11-25, the live inbox replayed exactly as a scan does, writing nothing):
- The scan runs and reads every email without errors. Yet **10 real job emails from Nov 23–25 produced 0 updates.**
- **Bug 1 (7 of 10): "already at that stage" emails are thrown away.**
  - When a card is already at or past the stage an email points to, the email isn't stored anywhere. It only appears once, in that scan's short "what I looked at" list.
  - This happened to:
    - "Thank you for applying" emails after applying had moved the card (six different companies);
    - a second interview email while the card was already in Interview;
    - a second rejection.
  - The rule was meant to stop cards moving backward. It also hides the email itself.
- **Bug 2 (3 of 10): real emails are mistaken for job-alert digests.**
  - `looks_like_digest` calls an email a job alert when it names 3+ saved jobs. With 330 saved jobs, ordinary emails trip it:
    - **Titles inside titles.** "Endpoint Systems Administrator" contains "Systems Administrator", the title of 6 other saved jobs at different companies.
    - **Generic company names.** Saved companies named only by a place or a kind of business (a city, a state, "Security") match words in a signature or address.
  - This happened to a real interview email (Nov 25) and two application emails.
- **The dry-run tool says "would create" for emails a real scan drops**, because it skips the stage check. That hid both bugs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No email about a saved job is ever lost (Priority: P1)

Every email the scan ties to one of your saved jobs is kept on that job, whether or not it moves the card:
- It moves the card (as today).
- **Or it's "noted":** the card is already there or further along, or it's a reminder. It's kept on the job, shown as new, and moves nothing.
- A new interview, assessment or offer email always shows as new, even when the card is already at that stage. A second interview email usually means a new time or link.

**Acceptance:**
1. With a card in Interview, a new interview email from that company shows on the job as a new email, and on Email updates under "New emails on your jobs". The card stays put.
2. A "Thank you for applying" email after the card is already in Applied shows on that job under "Your application".
3. Nothing about a matched saved job ends up in the "skipped" count.

### User Story 2 - Real emails aren't mistaken for job alerts (Priority: P1)

An email is only treated as a job alert / digest when it really lists several different jobs. Several rules guard this:
- **A clear match wins.** An email clearly about one saved job is never a digest:
  - a hiring-system template;
  - the company's own sending domain;
  - a person writing;
  - a reply in a thread;
  - an exact company + title match.
- **Titles count once.** A saved title found only inside another saved title doesn't count, and the same title at several companies counts as one title.
- **Generic company names don't count.** A company name made only of common words or places (a city, a state, "Security") never counts toward "names several companies".

**Acceptance:** the three real misses (anonymized into test fixtures) are kept, and real job alerts are still recognized as digests:
- LinkedIn "apply now to…";
- Glassdoor "New jobs in…";
- Lensa / Indeed lists.

### User Story 3 - The job page shows its emails, organized (Priority: P1)

On a job's page (and its pop-up), **Emails about this job** is grouped into sections, newest first inside each:
- **Interviews & next steps:** interviews, assessments, scheduling.
- **Decisions:** offers and rejections.
- **Your application:** confirmations ("we received your application"), status updates.
- **Messages from people:** recruiters and hiring managers writing to you.
- **Other:** anything else tied to this job.

Each section:
- shows how many emails it has, and hides itself when empty;
- shows 3 emails, then "Show N more".

Each email line:
- says what it was, when, and what it did to the card ("Moved to Interview", "No change needed", "New");
- opens the email in the app, or in your mail;
- has "Not this job" (the existing fix).

On top there's a one-line summary: "Latest: Interview invite · Nov 25".

**Acceptance:**
1. A job with 7 emails shows them in the right sections, with the newest summary on top.
2. On a phone, the sections fit the screen width and every button is easy to tap.
3. Opening the job marks its new emails as seen.

### User Story 4 - New emails on your jobs, at a glance (Priority: P2)

The Email updates page gets a short **New emails on your jobs** list: noted emails you haven't seen yet, from the last 14 days. Each opens its job. Board cards show a small "New email" dot until the job is opened.

**Acceptance:**
1. After a scan, a new noted email appears in that list and as a dot on its card.
2. Opening the job clears both.

### User Story 5 - Nothing disappears silently (Priority: P2)

Every job-looking email the scan decided not to show goes into **Looked at, not shown** on the Email updates page, for 30 days, with the plain reason:
- "Looks like a job alert";
- "Couldn't tell which job";
- "Not one of your saved jobs".

Plain spam is left out.

From each one:
- **This is about my job** opens the existing "Same job as… / One of my jobs" chooser; the email is then kept on that job.
- **Open the email.**

**Acceptance:** a digest skipped by mistake can be put on the right job in two taps. It then shows in that job's sections.

### User Story 6 - Get back what was missed (Priority: P1)

A one-time **Re-check the last 30 days** (a button on Email updates; also run once after this ships) reads the last 30 days of inbox and spam with the new rules. It only adds emails that aren't stored yet. It **never moves cards** from old mail: anything it finds is noted, or waits for you as usual.

**Acceptance:** after the re-check, the 10 emails from the investigation are on their jobs. No card moved.

### User Story 7 - An honest dry run (Priority: P3, owner/dev tool)

`scripts/email_scan_debug.py` runs the real decision code in a transaction that is thrown away. It reports per email what a real scan would do: moved, noted, waiting for you, looked-at (with the reason), or spam. It never claims "would create" for something a scan drops.

### Edge Cases

- **The same email in Inbox and Spam (or forwarded to yourself):** kept once, by its stable email id (as today).
- **An email that matches a job you later delete:** it leaves with the job (as today).
- **A noted email moved by hand to another job ("Not this job"):** it moves, and is remembered so it isn't placed back (as today).
- **Hundreds of job-alert emails a month:** "Looked at, not shown" keeps 30 days, at most 500 rows. Older rows are deleted by the existing sweep.
- **A re-check while a scan is running:** refused ("A scan is already running"), as today.
- **Yahoo's IMAP view of only the newest 10,000 messages:** the 30-day re-check fits easily, since the inbox gets about 120 emails a day.

## Requirements *(mandatory)*

- **FR-001:** A matched email whose card doesn't need to move is stored with the new status `noted`, never dropped. Interview, assessment and offer emails are always shown as new.
- **FR-002:** The digest test runs after matching. A clear single-job match (template, company domain, person, thread reply, company + title) skips it. Titles found only inside a longer saved title don't count; the same title at several companies counts once; companies with only generic names don't count.
- **FR-003:** The job's emails come back grouped into sections (a pure, tested mapping from email kind to section), with a latest summary and a `seen` flag.
- **FR-004:** Viewing a job's emails marks its noted emails as seen (`POST`, not on `GET`).
- **FR-005:** Email updates gets "New emails on your jobs" (unseen noted, 14 days) and "Looked at, not shown" (30 days, job-looking only, with plain reasons and recover actions).
- **FR-006:** A one-time re-check of N days (≤ 45) that only adds new rows and never moves cards.
- **FR-007:** The dry-run tool uses the real decision code and never writes.
- **FR-008:** Privacy:
  - email contents stay in the user's own rows, owner-only and with RLS;
  - tests use invented names;
  - no real mail in git or chat.
- **FR-009:** No AI. Rules only, and every rule is tested.

## Success Criteria *(mandatory)*

- **SC-001:** On the owner's inbox, the replay of Nov 23–25 keeps 10 of 10 job emails on their jobs (today 0 of 10).
- **SC-002:** Real job alerts are still caught. On the 5-day replay, LinkedIn, Glassdoor, Lensa, Indeed and Snagajob lists stay out of every job.
- **SC-003:** The owner can see every email about a job on its page, grouped, on a phone, without opening Yahoo.
- **SC-004:** No job-looking email disappears silently: each is moved, noted, waiting, or listed under "Looked at, not shown".
- **SC-005:** All existing email tests pass (the template, match and place suites). The new rules each have tests built from the anonymized real cases.

## Assumptions

- "Accurate" comes first: an email is only put on a job when the match is as sure as today's (same evidence rules). The new part is that sure matches are never thrown away.
- Auto-move stays as it is: forward moves only.
