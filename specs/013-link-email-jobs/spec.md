# 013: Link an email to the job it's really about

**Status**: built · **Branch**: `013-link-email-jobs`

## Problem

An interview email from an agency recruiter didn't match the job it was
about. The job was saved under the agency's full name, while the email came
from a person writing for the first time, on the agency's short domain, without
the job title. The scan filed it as "not one of your saved jobs". Adding it to
My Jobs made a second job, named from a line in the email, and there was no
way to say "this is the same job".

## What the user can do

1. **"Same job as…"** on any job made from an email (on the job's page and in
   its pop-up).
   - It opens a picker of the user's saved jobs: likely ones first, flagged
     "Likely", then the newest applications. There's a search box and "Show
     all".
   - Picking a job moves the copy's emails onto it.
   - The real job moves forward to the copy's stage, never backward.
   - The copy is archived.
   - A message says where the job is now, with **Undo**.
2. **"One of my jobs"** on an update the app couldn't place (Email page). The
   same picker puts the email on the chosen job and moves its card forward,
   like an approved update. The row's Undo reverses it.
3. **A guess on the row.**
   - When the email clearly points at one saved job, the row says "Looks like
     your *Title* job at *Company*", with **Yes, link it**.
   - With a guess, **Add to My Jobs** first asks "Is it one of your saved
     jobs?" and offers **No, add it as a new job**.
4. **The sender is remembered.** A linked email counts as an approved update,
   so the next email from that person goes to that job by itself.

## Smarter automatic matching

The app now recognises the initials of a company name of three or more words.
"DHS" stands for "Department of Harbor Services":
- as the sender's domain (`dhs.example.gov`), it counts like the company's own
  domain
- written in capitals in the subject or the text, it counts like the company's
  name
- written in lower case, it never counts

Two-word names have no initials, because two letters match too much.

## Rules

- Everything is per user: options, links and undo only touch the user's own
  jobs and emails (404 otherwise).
- Only a job made from an email can be folded into another one (409 for any
  other job). A job can't be linked to itself (422).
- Guesses use what the app already stores about an email: sender, subject, and
  the company and title it read. They never use the email body.
- Undo puts back:
  - the copy
  - its emails
  - the real job's stage, unless it has moved since
  - the real job's applied date

## API

| Method | Path | What |
|---|---|---|
| GET | `/v1/saved-jobs/{id}/link-options` | The user's other saved jobs, likeliest first |
| POST | `/v1/saved-jobs/{id}/link` `{target_id}` | Fold an email-made job into `target_id` → `{saved_job_id, job_listing_id, stage, undo}` |
| POST | `/v1/saved-jobs/{id}/unlink` `undo` | Undo the link (204) |
| GET | `/v1/email/events/{id}/link-options` | Saved jobs an unsaved update could be about |
| POST | `/v1/email/events/{id}/link` `{saved_job_id}` | Put the update on that job and move its card forward |

`GET /v1/email/events` adds `likely_job` to unsaved updates when exactly one
saved job stands out.

## Tests

- Backend `tests/api/test_job_links.py`:
  - initials matching, lower case ignored
  - ranking, and the one-clear-guess rule
  - an agency-domain interview landing on the job
  - link, then undo, for both flows
  - the sender being remembered
  - the guards
- Frontend `tests/components/SameJob.test.tsx`:
  - the picker's order, search and Show all
  - link with Undo
  - the Email page's "One of my jobs", "Yes, link it", and the check before
    adding
