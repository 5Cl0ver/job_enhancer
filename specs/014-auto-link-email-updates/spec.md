# 014: Email updates link themselves; one clear choice when they can't

**Status**: built · **Branch**: `014-auto-link-email-updates` · Builds on 013.

## Problem

After 013, an update the scan couldn't place showed:
- a "Looks like your … job" guess with its own button
- three more buttons: Add to My Jobs, One of my jobs, Not this

That was hard to read. Updates that clearly belonged to one saved job still
waited for a tap. A server restart mid-scan stopped the scan with "The scan
stopped. Try again."

## What the user sees

1. **Updates place themselves**, but only when they fit exactly one saved job
   (`place()` in `services/job_links.py`).
   - **Company:**
     - When the email named a company, it must be the job's company exactly.
       Look-alike spellings never count.
     - When it named none, the sender must write from the company's own
       domain (including its initials, `dhs.example.gov`), or the subject
       must carry the company's whole name of two or more words. One word in
       a subject ("Target start date") is never enough.
   - **Role:** if the email named a role, it must be this job's. Another role
     at the same company stays unplaced.
   - **Date:** the email must not be from more than 60 days before the job was
     saved.
   - **Never placed:**
     - a job site saved as the company ("Indeed")
     - a sender's own name used as the company
     - a look-alike company the scan flagged (`fuzzy_company`)
     - an email the user already said "Wrong job" to
   - Duplicate saves of one job count as one.
   - After every scan, the remaining "Not sure which job" updates are checked
     again, older ones too, so saving a job later clears its leftovers.
   - A placed update becomes a pending update (`likely_job`).
     - With "Move cards automatically" on, the card moves forward and the
       update appears under "Moved for you".
     - With it off, the update waits with **Move to *Stage*** and **Wrong job**.
     - If the card is already at or past that stage, or the stage was
       deleted, nothing moves. The email is kept with the job when it is
       already there, and stays unplaced when the stage was deleted.
   - A placement never teaches the app a sender. Only the user's approval or
     a sure match does.
2. **Wrong job**, on the app's own placements.
   - It also undoes the app's other placements on that job from the same
     sender or company.
   - It puts the card back to where it was before any of them, unless it has
     moved since. In that case later updates' Undo points past them.
   - It saves the answer in `detected_events.not_jobs`. That email, and later
     emails from the same sender or company, are never placed on that job
     again.
   - The emails return to "Not sure which job".
   - Undoing the user's own pick also records the job in `not_jobs`, but the
     email may still be placed on another job later.
3. **One clear choice when the app can't tell.** The "Not sure which job" rows
   have:
   - **Pick the job** (main; on a phone it fills the first line)
   - **Add as new job**
   - **Dismiss**

   The picker lists likely jobs first, and ends with "It's not saved: add it as
   a new job".
4. **A scan survives a dropped connection.**
   - When there's no answer, or a 502/503/504, the page says "The connection
     dropped. Trying again in a moment…" and retries the same pass every 20 s,
     up to 6 times.
   - A 409 ("a scan is already running") is only waited out right after this
     pass lost its answer. Otherwise it's shown at once.
   - Leaving the page stops the loop.
   - Whatever was read before the drop is already saved.
5. **Wording.**
   - Cards move by themselves "only when the app is sure which job an email
     is about".
   - The scan summary counts moves even when no new update was found.

## Data

- Migration `k9f0a1b2c3d5` adds `detected_events.not_jobs` (JSON, nullable).
  It only adds a column.

## API

- `POST /v1/email/scan` places leftover updates before auto-move runs. The
  matching runs off the request thread.
- `POST /v1/email/events/{id}/unlink` also accepts `likely_job` placements,
  whether pending, moved or hidden.
- `DetectedEventOut.likely_job` from 013 is removed; nothing used it.

## Tests

- Backend `tests/api/test_job_links.py`:
  - `TestPlace`:
    - company named or own domain
    - another role
    - look-alikes and loose words
    - job sites
    - sender as company
    - the date
    - ties, wrong jobs and duplicate saves
  - `TestPlacedAutomatically`:
    - a leftover moves its card
    - Wrong job puts it back and sticks
    - auto-move off waits
    - nothing to move keeps it with the job
    - ties stay
    - Wrong job covers the sender's other updates and later emails
    - a placement never teaches the sender
  - Also checked on the trial Postgres copy (rolled back).
- Frontend:
  - `SameJob.test.tsx`:
    - one main choice
    - add as new
    - ask for names
    - Wrong job on waiting and moved rows
  - `FullScanRetry.test.tsx`:
    - retry then finish
    - give up after about two minutes
    - 409 shown at once, but waited out after a drop
    - no retry on a login error
