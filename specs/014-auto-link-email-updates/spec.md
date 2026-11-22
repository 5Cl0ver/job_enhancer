# 014: Email updates link themselves; one clear choice when they can't

**Status**: built · **Branch**: `014-auto-link-email-updates` · Builds on 013.

## Problem

After 013, an update the scan couldn't place showed:
- a "Looks like your … job" guess with its own button
- three more buttons: Add to My Jobs, One of my jobs, Not this

That was hard to read. Updates the app could place, because the email named
the company of exactly one saved job, still waited for a tap. A server restart
mid-scan also stopped the scan with "The scan stopped. Try again."

## What the user sees

1. **Updates place themselves.**
   - After every scan, each update in "Not sure which job" whose names point at
     exactly one saved job's company goes on that job (`likely_job`). This
     covers older updates too, so saving a job later clears its leftovers.
   - With "Move cards automatically" on, the card moves forward and the update
     appears under "Moved for you".
   - With it off, the update waits with **Move to *Stage*** and **Wrong job**.
   - If the card is already at or past that stage, the email is kept with the
     job and nothing moves.
2. **Wrong job.** Only placements by company (`likely_job`) or by the user
   (`user_link`) have it.
   - It puts the card back, but only if it's still where the update put it.
   - The email returns to "Not sure which job".
   - The app never guesses that email again (`not_this_job`).
3. **One clear choice when the app can't tell.** The "Not sure which job" rows
   have:
   - **Pick the job** (main; on a phone it fills the first line)
   - **Add as new job**
   - **Dismiss**

   The picker lists likely jobs first, and ends with "It's not saved: add it as
   a new job".
4. **A scan survives a dropped connection.**
   - When there's no answer, or a 409/502/503/504, the page says "The connection
     dropped. Trying again in a moment…". It retries the same pass every 20 s,
     up to 6 times.
   - Whatever was read before the drop is already saved.
   - Other errors, such as a wrong app password, still stop at once.
5. **Wording.** Cards move by themselves "only when the app is sure which job
   an email is about".

## API

- `POST /v1/email/scan` now places leftover updates before auto-move runs.
- `POST /v1/email/events/{id}/unlink` also accepts `likely_job` placements,
  whether pending, moved or hidden.

## Tests

- Backend `tests/api/test_job_links.py::TestPlacedAutomatically`:
  - a leftover moves its card on the next scan
  - Wrong job puts it back, and it's never guessed again
  - with auto-move off it waits
  - nothing to move keeps it with the job
  - two jobs at the company, or a title alone, stay for the user
- Frontend:
  - `SameJob.test.tsx`: one main choice, add as new, ask for names, Wrong job
    on waiting and moved rows
  - `FullScanRetry.test.tsx`: retry then finish, give up after about two
    minutes, no retry on a login error
