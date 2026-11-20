# Quickstart: checking 006 works

Everything here runs on the local trial copy, never on live. Company names are
invented.

## Setup

```bash
# backend (from backend/)
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m ruff check .

# frontend (from frontend/)
npx tsc --noEmit && npx vitest run && npx vite build
```

Trial stack: the scripts in `C:\Users\fabia\job-enhancer-trial\bin`
(`alembic_scout.py upgrade head`, `run_backend_scout.py` → :8020,
`run_frontend_scout.py` → :5193).

## Slice 1 — origin, links, folders

1. Run the migration on the trial copy. Jobs a Scout finding points at have
   `origin = scout`; jobs whose link is the user's webmail have `email`;
   job-board ones `search`; the rest null. Downgrade and upgrade again: same
   result.
2. My Jobs: no card says "Manual". Scout jobs say "Claude Scout · fit N/10",
   email-made ones "From an email".
3. Pick **Where from → Claude Scout**: only Scout jobs remain and the URL has
   `?origin=scout`. Reload: the filter holds.
4. Open a Scout job: why, gaps and **See the search that found it**; the link
   lands in History on that run. "In folder …" lands on My Jobs with that
   folder selected.
5. Open an email-made job: the main button says **Open the email**; View email
   works.
6. Save a job with Job Catcher pointed at the trial API: it appears as "Job
   Catcher" and its folder shows in the list without a refresh.

## Slice 2 — save into, review, confirm

1. Edit a search: **Save into** defaults to a folder named after the resume
   type; pick another; the card shows it.
2. Drive a run with the connector test client (`tests/test_mcp_scout.py`
   pattern): report two fits above the bar and one below.
   - `report_job` answers `picked`, the run finishes on target, and My Jobs has
     **no** new jobs.
   - Find Jobs shows a badge of 2.
3. The review lists two ticked and one unticked, folder pre-filled. Untick one,
   tick the weak one, press **Save 2 to My Jobs**.
   - Exactly those two are in the folder, descriptions identical to the page
     copies, `origin = scout`.
   - The panel reads "2 saved to My Jobs › Folder · View"; View opens the
     folder; the badge is gone.
   - History shows the unticked pick as skipped with a **Save** button; pressing
     it saves it.
4. The review says "Asked for 5, found 2. Looked at N postings: …" and the
   numbers add up to N. Press **Keep looking**: a new run is queued, and none
   of the earlier postings come back as new.
5. Turn on **Save good fits without asking**, run again with a new posting: it
   is saved at once into the chosen folder; nothing waits for review.
6. Delete the search's folder, run again, confirm: the default folder is
   created and named in the confirmation.

## Slice 3 — names

1. `pytest tests/services/test_email_job_names.py`: the sample emails (sentence
   subjects, recruiter display names, hiring-system senders) give a clean role
   and company or none at all; never a sentence or a person.
2. On an email update with an unclear name, **Add to My Jobs** shows the two
   fields first.
3. Rename an email-made job: title and company change on the card, the board
   and the job page. Rename it to match another saved job: "You already have
   this job saved."
4. With two trial users sharing one listing, rename it as the first: the
   second user's job is unchanged.

## Slice 4 — phone

At 390 × 844 with touch (`tests/e2e/phone.spec.ts` additions): the review fits
without sideways scroll, the save bar sits above the tab bar, every box and
button is ≥ 44 px, the origin filter is in the filter sheet, Rename opens as a
sheet, and the Find Jobs tab shows the review count.

## After merge (needs the user's OK each time)

Back up the live database, merge, wait for Render (migration) and Vercel, then
on live: My Jobs labels look right, the existing Scout job says Claude Scout,
and one short real Scout run ends in a review instead of a save.
