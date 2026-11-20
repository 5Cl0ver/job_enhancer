# Feature Specification: Know where every job came from and where it went

**Feature Branch**: `006-know-where-things-are`
**Created**: 2026-11-19
**Status**: Draft
**Input**: The user, after their first real Claude Scout run (it worked: one job
saved with its exact description, three passed over): "I don't know where
these saved in my app. Some didn't even save properly, no description, nothing.
When it's done searching I want it to ask me which ones I want to save and to
what collection, auto-fill it and have me just press a button to confirm.
Should it create new collections or have me choose where it saves? All these
pages should link in some way, it's like missing something. I just need things
more organized, computer and phone."

Builds on [003-job-scout](../003-job-scout/spec.md),
[004-ux-overhaul](../004-ux-overhaul/spec.md) and
[005-phone-experience](../005-phone-experience/spec.md). The phone rule from
005 holds: everything here works on a phone as on a computer.

## Why

Three things made a working feature feel broken ([research.md](research.md) R1):

- **No job says where it came from.** Every card reads "Manual", whether Claude
  Scout found it, Job Catcher saved it, the user typed it in, or the app made
  it from an email. The two cards the user took for failed Scout saves ("no
  description, nothing") were made from emails: their title was a sentence out
  of the email and their company a person's name.
- **The app decides where things go and doesn't say.** Scout saves into a
  folder called "Scout" without asking, and the folder list didn't show it.
- **Pages don't point at each other.** A run's History doesn't lead to the
  folder; a saved job doesn't lead back to the run, Claude's reasons, or the
  email it was made from.

## User Scenarios & Testing

### User Story 1 — Every job says where it came from (Priority: P1)

Each job carries its origin: **Claude Scout**, **From an email**, **Job
Catcher**, **Saved by Claude** (from a chat), **Job board search**, or **Added
by you**. It shows on the card, the
row and the job page, and My Jobs can be narrowed to one origin.

**Independent test**: open My Jobs after a Scout run and an email scan; the
Scout job says "Claude Scout", the email-made ones say "From an email"; pick
the Claude Scout filter and only Scout's jobs remain.

**Acceptance**:
1. New jobs get the right origin whichever way they arrive.
2. Existing jobs are labelled where the app can tell for certain (Scout's from
   its own record; email-made ones from their link to the user's mail). The
   rest show no label rather than a guess.
3. A job from Scout shows Claude's fit score on its card and, on its page, why
   it fits, the gaps, and a link to the run that found it.
4. A job made from an email shows the email on its page, and its main button
   opens the email, not a job posting that doesn't exist.

### User Story 2 — Scout asks before it saves (P1)

When a search finishes, the page lists what Claude found. Good fits are ticked,
the rest are not; a folder is already chosen. The user changes what they want
and presses **Save N to My Jobs**. Nothing is saved before that.

**Independent test**: run a search that finds two good fits and one weak one;
the two are ticked and the folder says the search's folder; untick one, tick
the weak one, press Save; exactly those two are in that folder with their full
descriptions, and the page says where they went with a link.

**Acceptance**:
1. A finding Claude scored at or above the search's bar is ticked; one below is
   listed unticked with Claude's reasons; the user can tick or untick any.
2. A finding whose posting couldn't be copied can't be ticked and says how to
   save it by hand.
3. The folder is pre-filled from the search and can be changed for this save,
   including to a new folder typed on the spot.
4. One press saves the ticked jobs, word for word from the page copy, and
   answers: "2 saved to My Jobs › IT Admin · View".
5. Unticked findings stay in History and can be saved later while their page
   copy exists.
6. Until the user decides, the findings wait: a count shows on Find Jobs, and
   the next search still skips them.
7. A search can be set to **save good fits without asking**, for running it
   unattended. Off by default.
8. A run that comes back with fewer jobs than asked says why in one line: how
   many postings Claude looked through, and how many of those were already in
   My Jobs, seen in an earlier run, skipped by title, below the bar, or couldn't
   be copied, plus Claude's own closing note. **Keep looking** starts the same
   search again from where it left off.

### User Story 3 — Choose the folder when making a search (P1)

The search form has **Save into**: an existing folder, a new one named here, or
"a folder named after this search". The search card shows it.

**Acceptance**:
1. A new search defaults to a folder named for its resume type ("IT Admin").
2. The folder is created the first time something is saved into it, not before.
3. Deleting the folder doesn't break the search: it falls back to the default.

### User Story 4 — The pages lead to each other (P2)

- After a save: "N saved to My Jobs › Folder · View" opens My Jobs on that
  folder.
- History: each saved finding links to its job; the run links to its folder.
- My Jobs: a Scout job links to its run and shows Claude's reasons; an
  email-made job links to its email.
- The folder list updates as soon as a job is saved, without a refresh.
- A folder can be opened by link (`/jobs?folder=…`).

### User Story 5 — Fix a job's name (P2)

A job's title, company, place and link can be edited from its page. Jobs made
from emails get better names to begin with, and a card whose name looks like a
sentence, or whose company looks like a person, says "Check this job's name".

**Acceptance**:
1. Renaming changes only this user's job, never a listing someone else saved.
2. From an email saying "…the next phase of our recruitment process for the
   Platform Engineer role", sent by a named recruiter at a company address, the
   job is "Platform Engineer" at the company, not the sentence and the person.
3. When the app can't read a clean title or company, it asks instead of
   guessing: the email update offers the two fields to fill in before adding.

### Edge cases

- The search's folder was deleted before the user confirmed → the default
  folder is offered and named in the confirmation.
- The same job is ticked in two runs' reviews → saved once; the second says
  "Already in My Jobs".
- A run is stopped early → what was found so far is still offered for review.
- The page copy of a finding was removed (run deleted) → the finding can't be
  saved and says so.
- Auto-save is on and the user is also looking at the review → saved findings
  show as saved; nothing is offered twice.
- A renamed job's new name matches another saved job → allowed: the name is
  the user's own label, and the two jobs stay separate.

## Requirements

- **FR-001** Origin on every saved job (`scout` · `email` · `extension` ·
  `claude` · `search` · `manual`), set at creation, backfilled where certain.
- **FR-002** Origin shown on cards, rows and the job page; an origin filter on
  My Jobs.
- **FR-003** Scout job details on the job page: fit, why, gaps, run link.
- **FR-004** Email-made jobs: "From an email" label; primary action opens the
  email.
- **FR-005** Scout review: findings wait as picks; pre-ticked by fit; folder
  pre-filled; one confirm; unticked ones kept and saveable later.
- **FR-006** Per-search **Save into** folder and **save without asking**.
- **FR-007** Claude's instructions and tool replies say "kept for the user to
  confirm", count picks toward the target, and never claim a job was saved.
- **FR-008** A count of findings awaiting review in the navigation.
- **FR-009** Cross-links per User Story 4; folder list refreshes on save;
  folders linkable by URL.
- **FR-010** Edit a saved job's title, company, place and link, without ever
  changing a listing another user has saved.
- **FR-011** Better job names from emails; ask rather than guess when unclear;
  flag doubtful names on existing jobs.
- **FR-012** All of it on phone and computer, with the same actions.
- **FR-013** Every run accounts for what it looked at: postings seen, and the
  count for each reason one wasn't kept, shown on the review and in History.

## Success Criteria

- **SC-001** For any job in My Jobs, the user can tell how it got there without
  opening it.
- **SC-002** No Scout job reaches My Jobs without the user's press, unless that
  search is set to save without asking.
- **SC-003** After confirming, the saved jobs are one click away, and in the
  folder the confirmation named.
- **SC-004** From a Scout job, the run that found it is one click away; from a
  run, each saved job and its folder are one click away.
- **SC-005** Zero new email-made jobs whose title is a sentence or whose
  company is a person's name, on the app's set of sample emails.
- **SC-006** Confirming a five-job review takes one press when the defaults are
  right.
- **SC-007** For any finished run, the numbers on screen add up to the postings
  Claude looked through; none are unexplained.

## Out of scope

- Moving jobs between folders in bulk, nested folders, sharing folders.
- Claude reading a posting the extension couldn't copy (still "save by hand").
- To-dos and Email History (planned in 004), which plug into the same job page.
