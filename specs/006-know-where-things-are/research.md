# Research: Know where every job came from and where it went

## R1. What the first real run showed (2026-11-19)

A LinkedIn search for five IT Admin jobs, run by Claude in Chrome through the
connector: 24 postings in the window, 1 saved (fit 8/10) with its description
copied word for word by Job Catcher, 3 passed over for fit. The mechanism
worked. What the user saw afterwards:

| What the user said | What was happening | Where |
|---|---|---|
| "I don't know where these saved" | The job went to a folder named "Scout", created on the spot. My Jobs' folder list is cached for five minutes and nothing refreshes it when a run saves. No card says "found by Scout". | `services/scout_runs.py` `_scout_folder`; `hooks/useSavedJobs.ts` `useCollections` |
| "Some didn't even save properly, no description" | Those cards were not Scout's. They were made from emails ("Add to My Jobs" on an email update): the job's link is a mail search, it has no description, and its names come from the email's subject and sender. | `services/email_review.py` `track_event`; `services/email_job_names.py` |
| Title "next phase of our recruitment process in the …", company a person's name | The role is read from a subject phrase and the company from the sender's display name, which was the recruiter's own name. | `email_job_names.py` `role_name`, `company_name` |
| Every card says "Manual" | `job_listings.source` is `manual` for anything not from a job-board API: Scout, Job Catcher, typed in, email-made. Nothing records the real origin. | `services/saved_jobs.py` `save_manual_job` |
| "Ask me which ones to save, and to what collection" | Scout saves anything at or above the fit bar without asking, always into "Scout". | `scout_runs.py` `report_job` |
| "I only see three" (asked for five) | The run ended short of its target and the page doesn't say why. `check_jobs` counts what it skipped on each results page (already saved, seen before, excluded by title) but only tells Claude; nothing is stored, so 20 of the 24 postings are unaccounted for on screen. | `scout_runs.py` `check_jobs`, `finish_run` |
| "Pages should link" | History links a saved finding to its job, and that's all. No link to the folder, none back from a job to its run or to Claude's reasons, none from an email-made job's button to the email (it says "Apply Now"). | `components/scout/RunFindings.tsx`, `components/jobs/JobDetail.tsx` |

## R2. Origin is stored, not inferred

**Decision**: `saved_jobs.origin`, set by whichever code path creates the saved
job. Backfill only what is certain: Scout's from `scout_findings.saved_job_id`;
email-made from a listing whose link points at the user's webmail (the only
thing that writes such a link is `track_event`). Others stay null and show no
label.

**Rationale**: the same listing can be saved by different users in different
ways, so the origin belongs to the saved job, not the listing. A label that is
sometimes a guess would repeat today's problem (a confident "Manual" that
means nothing).

**Alternatives**: derive at read time by joining findings and events (three
joins on every list, and can't tell Job Catcher from typed-in); reuse
`job_listings.source` (shared across users; changing it changes dedup keys).

## R3. Scout proposes, the user disposes

**Decision**: a finding at or above the bar becomes a **pick** that waits. The
run page shows picks ticked and the rest unticked, with the folder pre-filled;
one button saves the ticked ones from their page copies. A search can opt into
saving without asking.

**Rationale**: the user asked for exactly this, and it is the safer default for
an agent writing into someone's tracker: suggest, pre-fill, confirm. Defaults
people usually keep make the common case one press, while leaving the choice
with the person ([smart defaults pattern](https://forge-ux-patterns.vercel.app/patterns/smart-defaults),
[bulk actions guide](https://www.eleken.co/blog-posts/bulk-actions-ux),
[PatternFly bulk selection](https://www.patternfly.org/patterns/bulk-selection/)).
The page copy already exists for every posting Claude opened, including the
ones under the bar, so "save this one anyway" costs nothing new.

**What stays the same for Claude**: one line to start, the same four tools,
the same small replies. `report_job` answers `picked` instead of `saved`, the
target counts picks, and the playbook says the user confirms in the app. Picks
count as seen, so the next run doesn't bring them back.

**Alternatives**: keep auto-save and add "undo" (the user must clean up after
the agent; the opposite of what they asked); ask Claude to ask in chat (the
choice would live in a chat the app can't see, and wouldn't work unattended).

## R4. The folder belongs to the search

**Decision**: each search has **Save into**: a folder, or none meaning "a
folder named after this search's resume type". The folder is created when the
first job is saved into it. The review can override it for one save, including
with a new name.

**Rationale**: the user's own framing was "create new collections or have me
choose". Resume types are already how they think about their search, so a
folder per type is the default that needs no thought; creating it lazily avoids
empty folders for searches that find nothing.

**Alternatives**: one "Scout" folder for everything (today; mixes five kinds of
role); a folder per run (dozens of folders in a week).

## R5. Names read from emails

**Decision**:
1. A role is taken only from a phrase that names one ("for the X role", "X
   position", "application for X", a hiring system's template field). Lead-ins
   such as "next phase of our recruitment process in/for the" are stripped, and
   a result that still reads as a sentence (starts lower-case, has a verb, runs
   past eight words) is rejected.
2. A sender's display name that looks like a person (two or three capitalised
   words, no company word) is not a company. The company then comes from the
   email's own text or, failing that, the sender's domain when it isn't a
   mail provider or hiring system.
3. With no clean title or company, the app asks: the email update shows the two
   fields to fill in before "Add to My Jobs".
4. Existing jobs with a doubtful name get a "Check this job's name" note that
   opens the rename.

**Rationale**: a wrong name is worse than a question. The junk card was the
single biggest reason the user thought saving was broken.

## R6. Renaming without touching anyone else's data

**Decision**: `PATCH /v1/saved-jobs/{id}/listing`. If the listing is a manual
one only this user has saved, edit it in place. Otherwise copy it into a new
manual listing for this user, point the saved job at the copy, and edit that.
A rename that would duplicate another of the user's saved jobs is refused.

**Rationale**: `job_listings` is a shared pool keyed by title, company and
place; `save_manual_job` already follows the "never mutate a listing another
user relies on" rule, and this applies the same rule to edits.

## R7. Keeping lists fresh and pages connected

**Decision**: anything that saves a job invalidates `saved-jobs` and
`collections`; the Scout run page does so whenever its saved count changes.
My Jobs reads `?folder=` and `?origin=` so other pages can link to a filtered
view. The job page gets a "Where this came from" block built from one small
request (`GET /v1/saved-jobs/{id}/source`).

**Rationale**: the folder not appearing was a cache that nothing told to
refresh. Linkable filters are what let "View" land on the right place instead
of the top of a 300-job list.
