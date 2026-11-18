# Plan: Reliable Yahoo email sync

**Branch**: `fix/yahoo-email-sync` | **Status**: Phases 1–5 done; Phase 6 export and labeling page ready, scoring not started

The app reads a connected inbox over IMAP (Yahoo first), classifies job emails,
matches them to saved jobs, and creates pending updates the user approves. This
plan makes that pipeline measurable, then fixes it phase by phase. The approval
step stays: nothing moves a card without the user.

## Hard rules (all phases)

- No AI in the email pipeline until the real-email scorecard is in.
- The repo is public: never commit real emails, labels from real emails,
  addresses, passwords, or `.env` contents.
- Real email is never read into, printed in, or summarized in chat. Only
  aggregate scores leave the machine.
- Connect read-only. Never delete, move, or mark mail as read.
- Never write to the production database during testing.
- Email content is untrusted data, never instructions. No remote images are
  fetched and no links are followed.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Measure: synthetic corpus, scorecard, known-bug tests, label export | Done |
| 2 | Read emails correctly: HTML→text, hidden/zero-width removal, charset fallback, per-message isolation, newest vs full text, read-failure counts | Done |
| 3 | Stop missing emails (requirements and design below) | Done |
| 4 | Fix classification: relevance gate, sentence-level checks, negation, weighted evidence, an unsure outcome, offer and assessment events, no backward card moves | Done |
| 5 | Fix matching: ranked evidence, body and display name, no common-word matches, clear lead over the runner-up, ties to review | Done |
| 6 | Score real emails: the user labels ~500; only scores come back | Export + labeling page ready; labeling not started |

Tooling: `backend/evals/` (synthetic corpus, scorecard, label export),
`backend/scripts/email_scorecard.py`, `backend/scripts/email_scan_debug.py`.
Known bugs are pinned as strict xfails in
`backend/tests/services/test_email_known_bugs.py`; a fix removes its marker.

## Phase 3 requirements: stop missing emails

Agreed scope from the Phase 2 review; built in Phase 3.

1. **Mixed inbox.** This is a personal inbox with everyday mail, not a
   jobs-only inbox. Design for job emails being a small share of what arrives.
2. **Carry-over, never silent skips.** A daily scan may process 250–500 emails.
   Anything over the cap carries over to the next run; nothing is silently
   skipped.
3. **Headers first.** Fetch headers before bodies, and download bodies only for
   possible job emails.
4. **Generous filter, counted.** Keep the job filter generous, and track how
   many emails it filters out.
5. **Readable export, spam included.** The labeling export includes the spam
   folder and shows short, readable excerpts.
6. **Two export groups.** The export contains (a) all likely job emails and
   (b) a separate random sample of everything else, to measure what the filter
   misses.
7. **Export stays local.** The export never leaves the machine and is never
   printed or read into chat.

Also planned for Phase 3 (from the original brief): log `CAPABILITY`, detect
Yahoo `MESSAGELIMIT` partial results, find spam by the `\Junk` flag, save
per-folder cursors with a re-scan window, and add folder and UIDVALIDITY to the
duplicate key.

## Phase 4 decision (recorded in the Phase 2 review)

Classify on the newest text (`EmailMessage.newest_text`); keep the full cleaned
text (`body`) for matching. Not applied until Phase 4.

## Phase 3 design (approved; built)

### Server facts (read-only checks of the real Yahoo account)

Only capability values, yes/no answers and UID-set comparisons were collected;
no message content. Mailbox counts are deliberately not recorded here.

- `CAPABILITY` after login: `IMAP4rev1 ID MOVE NAMESPACE XYMHIGHESTMODSEQ
  UIDPLUS LITERAL+ CHILDREN UNSELECT X-MSG-EXT OBJECTID IDLE ENABLE UIDONLY
  X-UIDONLY LIST-EXTENDED LIST-STATUS SPECIAL-USE MESSAGELIMIT=1000 PARTIAL
  APPENDLIMIT=41697280 COMPRESS=DEFLATE`. No `CONDSTORE`/`QRESYNC`.
  `MESSAGELIMIT=1000` appears only after login.
- `SPECIAL-USE` works: one top-level `\Junk` folder with a standard name;
  `LIST (SPECIAL-USE)` is accepted.
- `UIDVALIDITY` and `UIDNEXT` are returned on `EXAMINE` for inbox and spam.
- **`UID SEARCH SINCE <date>` is silently capped at 1000 with a plain `OK`**
  (no `[MESSAGELIMIT]` code). The capped result is exactly the **newest 1000**
  UIDs of the folder, as one contiguous block. `UID SEARCH ALL` and
  `UID FETCH 1:* (UID)` returned every visible message.
- Large folders are shown through a 10,000-message view: anything older is not
  visible over IMAP at all.

So the pre-Phase-3 scanner (`SEARCH SINCE 45 days`, newest 250 of the result)
only ever saw the newest 250 inbox messages, however old the rest of the
window was, and never saw spam.

### How a scan is triggered today

Only by the **Scan** button in Settings (`POST /v1/email/scan`), a synchronous
request; there is no scheduled email job. IMAP calls time out after 20 s each,
but the request as a whole had no limit. Phase 3 adds a 60 s time budget per
scan (inbox gets up to 75%, spam the rest); work past it carries over, so the
45-day first-run backfill takes several Scan clicks. A scheduler that keeps
scanning automatically is **not** added in this phase.

### Finding mail: cursors over UIDs, no date search

Per folder (inbox, then the folder flagged `\Junk`; by name only if no folder
carries the flag; other folders are out of scope):

1. `EXAMINE` (read-only); read `EXISTS` and `UIDVALIDITY`. No UIDVALIDITY →
   folder skipped and reported.
2. `UID SEARCH ALL`, accepted only if its count equals `EXISTS` and there is no
   `[MESSAGELIMIT]` code. Otherwise page by sequence number in spans of 900;
   if pages are also incomplete the folder is skipped this run (`partial`) and
   its cursor does not move. `EXISTS` at 10,000 is reported `view_limited`.
3. Cursor = the fully processed UID range `[backfill_low, last_uid]` plus
   `backfill_floor` (`email_folder_states`). New mail (above `last_uid`) is
   processed oldest first; the first-run **45-day** backfill walks down from
   the newest message to the floor (found by binary search on `INTERNALDATE`,
   with each message's own date checked too). After the backfill, the last
   **2 days** are re-checked (headers; known emails skipped).
4. UIDVALIDITY change: the folder's cursor resets (backfill again) and the
   change is reported; deduplication stops repeats.

### Reading mail: headers first, `BODY.PEEK`

- Headers in batches of 50: `UID FETCH … (UID INTERNALDATE RFC822.SIZE EMAILID
  BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO SUBJECT DATE MESSAGE-ID LIST-ID
  LIST-UNSUBSCRIBE AUTO-SUBMITTED PRECEDENCE)])` (`EMAILID` only with
  `OBJECTID`). Already-detected emails (by location or EMAILID) are skipped.
- The generous header filter (`email_prefilter`) keeps hiring platforms, job
  words in the subject or sender name, sender domains that look like a saved
  company, and any non-bulk sender; it drops only bulk mail with no job signal.
  Drops are counted per folder and reason.
- **The 500-per-run cap applies to full body downloads only**
  (`UID FETCH … (UID BODY.PEEK[])`, batches of 10); 100 of it is reserved for
  spam, and the inbox's unused share passes on. Header fetches are not capped.
  Messages over 10 MB are read from headers only and counted.
- Every requested UID must come back; a missing one is re-searched and
  skipped only if it no longer exists, otherwise the folder stops (`partial`).
- Carry-over: a batch stops *before* the email that would exceed the cap or
  the time budget, and the cursor only covers completed batches, so anything
  not processed is outside the range and is picked up next run.

### One connection, sequential folders, backoff

One connection per scan, reused for both folders, one folder at a time; an
in-process lock prevents overlapping scans of one account (409). A rate limit
(`[LIMIT]`, `[UNAVAILABLE]`, "rate limit"…), an unexpected `BYE`, a dropped
connection or a timeout stops the scan with completed work kept, and sets an
exponential backoff with jitter (1 minute doubling to 60) stored on the
account; a scan during backoff returns 429 with `Retry-After` and doesn't
connect. A clean scan clears the backoff. `CAPABILITY` is logged per scan.

### Duplicates

1. **Physical key** `(account, folder, UIDVALIDITY, UID)`, unique.
2. **Logical key**, unique per account: `emailid:<EMAILID>` when the server
   provides it; otherwise `mid:<sha256(Message-ID + sender + subject + date +
   body)>`, so a reused or forged Message-ID on a different email produces a
   different key and can't suppress it; emails with no usable ID get no key
   and never collapse together. Mail moved between inbox and spam keeps its
   EMAILID (or its Message-ID and content), so it creates no second update.
3. **Legacy rows** (before this phase: inbox, no UIDVALIDITY) are adopted when
   a scan reaches the same inbox UID with the same subject and sender; a
   different subject means the UID now names another email.

### Schema changes (migration `b3c4d5e6f7a8`)

- `detected_events`: `folder` (not null, default `INBOX`), `uidvalidity`,
  `logical_key`; unique `(email_account_id, message_uid)` replaced by unique
  `(email_account_id, folder, uidvalidity, message_uid)` and unique
  `(email_account_id, logical_key)`. Existing rows become `INBOX` / NULL.
- New `email_folder_states` (cursor per account + folder; RLS enabled).
- `email_accounts`: `sync_backoff_until`, `sync_backoff_level`.
- Downgrade restores the old key and refuses if rows would collide.
- Tested on SQLite (upgrade, legacy rows, keys, round trip, refusal); the
  Postgres SQL is rendered offline (`alembic upgrade … --sql`) for review. Not
  run on any real database.

### Reporting

The scan response adds per-folder counts (visible, new, headers read, filtered
out, kept, already known, bodies fetched, oversize, out of window, vanished,
re-checked, carried over), `partial` reasons, `view_limited`,
`uidvalidity_changed`, the total carried over, and why a scan stopped early.
No folder names or email content.

### Label export

`email_scan_debug.py --export --days 45` runs the same read-only sync from
empty cursors (nothing saved, no database writes) over inbox and spam for 45
days, with no body cap and no time limit, and writes `likely_job` (everything
the filter kept) plus `sample_other` (seeded random sample of 150 drops).
Columns add `group`, `uidvalidity`, `filter_reason`, `read_issues`. Output
stays in git-ignored `email_exports/`; export mode prints counts and paths
only.

### Findings from the first real 45-day export (counts kept out of the repo)

- The uncapped, one-connection export was dropped by the server partway
  through the inbox (`connection_lost`). The spam folder and the
  `sample_other` group were never reached, because sampling runs after all
  folders. A long export needs the same carry-over a scan has: resume from
  where it stopped, or run in capped passes.
- In a mixed inbox the header filter keeps most mail, because almost any
  non-bulk sender counts as "personal". It is generous as intended, but
  `likely_job` is far too large to hand-label, so labeling needs a sample.
- A noticeable share of real messages read as blank with no explanation
  (not attachment-only). Synthetic data has none, so real MIME shapes are
  missing from the generator. Diagnose with counts of MIME structure only.

## Phase 4 (built): classification and card action

- Classifies the **newest text** (`EmailMessage.classify_text`); the full
  cleaned text stays on `body` for matching. Matching is unchanged.
- **Relevance gate**: the email must mention a job concept (or come from a
  talent/careers sender or a hiring platform); list/marketing mail must also
  reference the reader's own application, or reject them. Job-alert digests
  are `unknown`.
- **Sentence-level weighted cues** for applied, interview, assessment, offer,
  rejected and recruiter. Negation before a cue drops it; conditional
  sentences ("if your experience matches…") and sentences looking back at a
  past interview count for little; a receipt counts little once an outcome is
  present.
- **Unsure** for weak evidence, close or opposite-polarity outcomes, or an
  application status with no readable outcome. Unsure never proposes a move;
  it is listed for review.
- **Offer → Offer** and **assessment → Take-Home Assignment**.
- **Card action** is separate from type: reminders never move a card; a move
  only goes forward in the user's own stage order (no backward moves from old
  confirmations); a deleted target stage is flagged, and approving it returns
  a clear 409 instead of a silent non-move.
- A public-style example set (`test_email_public_examples.py`), written
  independently of the generator, checks the rules are general.

## Phase 5 (built): matching an email to the right saved job

`app/services/email_match.py` replaces the fuzzy matcher. It reads the subject,
the sender display name, the sender and Reply-To domains, and the full cleaned
text, and ranks evidence:

1. job URL or a job id from it (`job_url`, `job_id`)
2. known sender: a personal address that already sent an update about the job
   (relays, no-reply and shared inboxes such as careers@ never count)
3. rare company words + the exact job title (`company_title`)
4. company + date, when it is the user's only saved job at that company

A match needs a clear lead: if another job also has strong evidence (tiers
1–3) the email goes to review. Review, never an automatic match: title only,
several roles at one company, several jobs that fit equally, a near-miss
company spelling, a company-only email that predates the saved job, or
conflicting evidence. Common words and company suffixes are ignored, so one
shared word can't make a match; a company made only of common words must
appear whole. Hiring platforms and webmail are never the employer.

One related classification change: a sender whose own domain names a saved
company is itself a job signal, so "can we move our call to Monday?" from the
employer is read.

### Review items are stored (Phase 5 follow-up, migration `c4d5e6f7a8b9`)

- A card-moving email whose job is unclear, and every *unsure* email, is saved
  as a `detected_events` row with status `needs_review`, `saved_job_id` NULL,
  the reason in `match_evidence` and the candidate saved-job ids in
  `review_candidates`. It keeps the email's physical and logical keys, so a
  rescan, a moved cursor or a move to spam never repeats or loses it, and there
  is no cap (the 40-item cap applies only to the informational "What else I
  looked at" list).
- `POST /v1/email/events/{id}/resolve` takes the chosen saved job (one click
  on a candidate, or any other active saved job) and, for an unsure email, its
  type. The row becomes an ordinary pending update; the card still moves only
  on Approve. A backward move is refused. Dismiss works as before.
- Every stored row keeps its `match_evidence`, so the reason shows after the
  scan too.
- Known senders are learned only from updates the user **approved**
  (`applied` / `auto_applied`); pending, review and dismissed rows teach
  nothing.
- Downgrade refuses while any jobless review row exists. Tested on SQLite, on
  offline Postgres SQL, and on a disposable Postgres copy of the local
  database (upgrade, replay of the existing events with no new rows, refusal,
  downgrade, re-upgrade).
- Stress cases (`evals/email_matching_cases.py`, seeded, separate from the
  main corpus so its baseline doesn't move): no title, company only (in text
  or only in the sender domain), company only but older than the saved job,
  several roles with and without a title, two titles, an ATS relay, title
  only, a known personal sender, and a shared inbox with approved history.
  The rule tested: never auto-match a wrong job; review always offers the
  right one.

## Reading fix found by the Phase 6 export (Phase 2 follow-up)

The first real label export had too many blank or cut-off emails. Measured by
counts only (`scripts/email_read_diagnose.py`, per-stage sizes and the rule
behind every dropped character, plus a one-off comparison with a headless
browser's visible-text count), the causes were all in hidden-element
handling, not charset decoding or parsing:

- `font-size:0` was treated as hiding a whole subtree, but responsive layouts
  zero the wrapper and set a real size on each column. Font size is now
  inherited and computed: an absolute size on a child makes it visible again;
  `em`/`%` inside a zero wrapper stay zero; anything under 4px is hidden
  (this also catches 1px "tiny text" tricks).
- HTML's implied end tags were missing, so one hidden `<tr>`, `<td>`, `<li>`
  or `<p>` (or an unclosed `<head>`) hid everything after it.
- A text/plain stub ("view in browser") was used even when the HTML had the
  real body; a plain part under half the HTML's visible text is now replaced.

What stays blank is what a browser also shows as (almost) no text: image-only
emails, including ones whose article text sits inside a `display:none` box.
Hidden text is still removed, including hidden prompt-injection-style text
(`tests/services/test_email_html_structures.py`). `email_label_export.py
--rebuild` re-reads the same selected rows after a reader fix.

## Email Updates page and noise rules (after the first real-inbox trial)

A full 45-day trial produced too many review items, mostly noise. Measured by
counts only, most were job-alert / recommendation digests, "based on your
profile" mail, low-value confirmations, unclear "status portal" emails, and
the same job saved twice. General rules now:

- Job alerts, recommendation digests and "X is hiring" promos are not
  updates; an email naming three or more saved jobs across companies (or
  three saved companies) is a digest and is skipped. "Your profile" no longer
  counts as being about the reader's own application.
- "Thank you for applying" is an application confirmation.
- The same job saved twice ("Acme" / "Acme, Inc.", same title) is one job; the
  most recently saved copy is the one updated.
- Only an IMPORTANT update (interview, assessment, offer, rejection) whose
  job is unclear becomes a question. Unclear emails and confirmations that
  can't be tied to one job are stored with status `hidden` (no migration:
  `status` is free text) and never ask anything. A near-miss company spelling
  alone is too weak to ask about (on the real inbox it was almost always a
  look-alike word in another sender's boilerplate), so it is hidden too.

`/email-updates` shows questions, then important updates (one plain sentence
each, "Apply update" / "Not this"), then collapsed confirmations and hidden
items. Evidence and email details stay under "Details". Answering a question
with a job applies that update (the click is the approval). The Settings card
keeps connect + scan and links to the page.

### Unsaved jobs and recruiter messages (migration `d5e6f7a8b9c0`)

- An important update (interview, assessment, offer, rejection) that matches
  no saved job — or only by a look-alike company spelling — is kept with status
  `unsaved` instead of being dropped. It never moves a card. The page shows it
  under "Not in your saved jobs" with **Add to My Jobs** (creates the job via
  the manual-add path and places its card in the stage the email describes —
  the user's click) and **Not this**. Reminders, alerts and digests are still
  not kept.
- Recruiter messages are kept with status `contact` in a small collapsed
  "Recruiter messages" section.
- Company and role for these come from the email (`email_job_names`: subject,
  an organisational sender name, or the sender's own domain — never a personal
  name) and are stored in `job_company` / `job_title`.

## Phase 6 prep: labeling export and page

- `scripts/email_label_export.py` reads the inbox + spam read-only and writes
  `email_exports/phase6-labels-seed<seed>.csv` (git-ignored; other paths are
  refused). Saved jobs and the encrypted app password come from a **local**
  database only (127.0.0.1/localhost, opened read-only).
- Three resumable steps (`evals/email_label_export.py`), progress saved in
  `<sheet>.state.json` after every batch: a `headers_only` sync with saved
  cursors until both folders are complete; a seeded selection (350 kept by the
  header filter, stratified by keep reason with at least 20 per reason, plus
  150 it dropped); then `BODY.PEEK` fetches of just those rows, each written
  as it arrives. Dropped connections and rate limits retry with backoff; a
  stopped run resumes with the same command, without repeating rows.
- The summary (`<sheet>.summary.json`, also git-ignored) has counts only: by
  folder, by keep/drop reason, the selection by group/folder/reason, and
  blank bodies by MIME structure (content types only).
- `scripts/email_label_server.py` serves a labeling page on 127.0.0.1: one
  email at a time, click its type (1–7), its saved job or "none" (0), an
  optional "reminder — no card change" flag and a note. Every click saves to
  `<sheet>.labels.json`; `--merge` (or the page button) writes
  `<sheet>-labeled.csv` for scoring. The API needs the per-run key in the
  printed link and the right Host header; email text is rendered as plain
  text only, under a strict CSP.
