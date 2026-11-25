# Research: Every email about a job, kept and organized

All findings come from read-only runs against the live inbox and database on 2026-11-25. Nothing was written. Real names appear only where the owner already named them in chat; test fixtures will use invented names.

## R1: Where the 10 emails went (the replay)

- **Method:** run the live scan as-is: real cursors, real known keys, `sync_mailbox`, then `detect_events` inside a transaction that is rolled back.
- **Result:**
  - the sync returned all 10 emails;
  - none was "seen" before;
  - `detect_events` created 0 rows.
- **Skipped counts:** `already_at_or_past_stage: 6`, `job_alert: 6`, `no_saved_job: 1`.
- **Per email, from replaying the decision steps:**
  - 7 matched their saved job clearly (template or company evidence), but `card_action` said `already_at_or_past_stage`. The code then only counts them under "skipped" (`email_scan.py`, the final `else` of the storing chain).
  - 3 were caught first by `looks_like_digest` and skipped as `job_alert` before matching was even used.
- **Why the digest test fired:**
  - **Title inside title:** "Endpoint Systems Administrator" hit 7 saved jobs titled "Systems Administrator" across companies (≥ 3 jobs, ≥ 2 companies).
  - **Same title, many companies:** "Business Systems Analyst II" hit 4 saved "Business Systems Analyst" jobs.
  - **Generic company names:** a 1,770-character interview email hit 3 "companies": "City of Portland" (from an address), the user's own saved company, and "The 20".
- **Decision:** two separate fixes (R2, R3). Each gets regression tests built from anonymized copies of these shapes.

## R2: Keeping emails that don't move a card

- **Decision:** add a status `noted`. In `detect_events`, a matched email with `propose == False` because of `already_at_or_past_stage` or `reminder` is stored as `noted`, with `saved_job_id` set and `target_stage` kept (for the line "No change needed: already in Interview").
  - It never touches the card.
  - It is part of `known_keys` and the seen set, so it's never re-read or repeated.
  - It's excluded from the pending list.
- **Always new:** interview, assessment and offer emails are stored `noted` and shown as new even though the card didn't move.
- **Alternatives rejected:**
  - **Proposing the move anyway:** it would drag cards backward, which is what the rule prevents.
  - **Reusing `hidden`:** `hidden` means "unclear, keep quiet", which is the opposite of "sure, show it".

## R3: The digest test

- **Decision:**
  1. Run matching first.
  2. Skip the digest test when the match is clear, meaning any of these:
     - a template;
     - the sender's domain belongs to the matched company;
     - a person writing (existing `is_sender_person` / personal mail signals);
     - a reply in a thread (`Re:` / In-Reply-To);
     - company + title evidence.
  3. In the digest test itself:
     - ignore saved titles found only inside a longer saved title found in the same email;
     - count distinct titles, not jobs;
     - count a company only if its name has a distinctive word: not a US state, city or common English word, and not a generic job word. The word list is small, shipped in code, and tested.
- **Why:** job alerts come from job boards (LinkedIn, Glassdoor, Indeed, Lensa, Snagajob) and list several different titles. The real misses were single-company emails, which a clear match identifies.
- **Alternatives rejected:**
  - Raising `DIGEST_MIN_JOBS`: it hides the cause, and a 4-title alert would then slip through.
  - Dropping the digest test: alerts that name the user's saved jobs would land on jobs.

## R4: Sections on the job page

- **Decision:** a pure mapping from event type to section:
  - `interview` / `assessment` → Interviews & next steps;
  - `offer` / `rejected` → Decisions;
  - `applied` → Your application;
  - `recruiter` and person-written mail → Messages from people;
  - anything else → Other.
- Sections are built in the app from the existing `/v1/email/job-emails` list, which gains `seen` and the noted rows. No new endpoint is needed for the list.
- **Phone:** each section is a small card with a header and count, 3 lines shown, then "Show N more". Lines reuse today's `JobEmails` row (open in the app, open in mail, Not this job).

## R5: Seen and new

- **Decision:** a nullable `detected_events.seen_at`.
  - `POST /v1/email/job-emails/seen {job_listing_id}` sets it for that job's noted rows. The job page calls it once after it shows them.
  - "New" means `noted` and `seen_at IS NULL`.
  - The board's dot comes from `job-emails/latest`, which adds `unseen` per job, so there are still no per-card requests.

## R6: Looked at, not shown

- **Decision:** store skipped job-looking emails as `detected_events` rows with status `skipped` and a `skip_reason` (`job_alert`, `no_saved_job`, `unclear`).
  - Plain spam (`UNKNOWN`, no match) is never stored, as today.
  - They're kept 30 days and at most 500 per account, by a daily sweep (the APScheduler jobs in `main.py`).
  - Stored rows are part of the seen set, so job alerts are no longer re-read on every scan. That also makes scans a little faster.
- **Recover:** "This is about my job" uses the existing 013/014 linking (`/v1/email/events/{id}/link`); the row becomes `noted` on that job.
- **Alternative rejected:** a separate table. Same fields, and twice the code.

## R7: The re-check

- **Decision:** `POST /v1/email/recheck {days ≤ 45}`.
  - It runs the sync with a temporary window, like the dry-run tool (empty cursors, `known_keys` passed so stored emails aren't re-read).
  - It then runs `detect_events(..., recheck=True)`: no auto-move, and what the scan would have proposed becomes `noted` (or pending for the user).
  - It never saves cursors.
  - It takes the same per-account lock as a scan.
- **Cost:** about 120 inbox emails a day, so about 3,600 headers and about 1,000 bodies for 30 days. That's a few minutes, once.

## R8: The dry-run tool

- **Decision:** `scripts/email_scan_debug.py` calls the real `detect_events` in a transaction that is rolled back, then prints each row's status and reason. The separate re-implementation of the decision (which caused the "would create" lie) is removed.
