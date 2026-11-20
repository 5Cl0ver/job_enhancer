# Feature Specification: See and control everything Claude Scout is told — the Instructions page and the run log

**Feature Branch**: `010-scout-instructions`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "I need you to add to the app all the instructions
we are giving Claude, because I think some stuff is getting messed up. I need to
see everything it's giving instructions. Build a nicely organized thing that is
secure, allows me to edit and control." Then: yes to a per-run log of every
message between Claude and the app; edits are for the user's account only.

Builds on [003-job-scout](../003-job-scout/spec.md),
[007-local-companies](../007-local-companies/spec.md),
[008-scout-fewer-repeats](../008-scout-fewer-repeats/spec.md) and
[009-scout-smarter-search](../009-scout-smarter-search/spec.md); 009 promised
its starting limits would be visible and changeable here. The phone rule from
005 holds: everything here works on a phone as on a computer.

## Why

Today everything Claude is told about a Scout run lives in the code: the main
steps, the extra steps per kind of search, the scoring weights, the limits, the
tool descriptions and the replies the app gives at each step. When a run goes
wrong, the user can't see what Claude was asked to do, or what Claude actually
sent and got back, so they can't tell a bad instruction from a bug.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See everything Claude is told (Priority: P1)

A new **Instructions** tab in Claude Scout lays out, in order, everything a
run gives Claude:

- **Main steps** (the playbook).
- **Extra steps** for Google Jobs, Local companies and Anything I'd be good at.
- **Scoring**: the five parts of the 0–10 score and their weights.
- **Limits**: pages per run, titles per broad run, companies per Local run,
  and the fixed ones (how long things are remembered, when titles rest).
- **Rules Claude always follows** (locked).
- **What each tool tells Claude** (locked).

Each section says in one line what it's for, and shows whether it's the
original or the user's edited version.

**Why this priority**: Seeing the instructions is the user's first need ("I
need to see everything"), and the rest builds on this view.

**Independent Test**: Open Find Jobs → Claude Scout → Instructions on a phone.
Every section listed above is there, readable and labelled original or edited.

**Acceptance Scenarios**:

1. **Given** a user who never edited anything, **When** they open
   Instructions, **Then** every section shows the original text and an
   "Original" label.
2. **Given** the locked sections, **Then** they show a lock and no edit
   control.
3. **Given** the page on a phone, **Then** nothing needs sideways scrolling,
   and long texts are folded with "Show all".

---

### User Story 2 — Edit, reset and restore (Priority: P1)

The user can edit the main steps, the three sets of extra steps, the scoring
weights and three limits. Each has Save, Reset to original, an "Edited" label,
and a history of earlier versions with Restore. Edits only change the user's
own runs.

**Why this priority**: Control is the user's second ask ("allows me to edit and
control").

**Independent Test**: Edit the main steps and save; Preview shows the new text.
Reset to original; Preview shows the original. Restore the edited version from
history; it's back.

**Acceptance Scenarios**:

1. **Given** an edited text, **When** saved, **Then** the next run uses it and
   the section says "Edited" with the date.
2. **Given** an edited text, **When** the user presses Reset to original,
   **Then** the original applies again, and the edit stays in history.
3. **Given** the history, **When** the user restores a version, **Then** it
   becomes the current one (as a new entry in history).
4. **Given** scoring weights, **When** they don't add up to 10, **Then** Save
   is refused with "The parts must add up to 10 (now 9)".
5. **Given** a limit, **When** it's outside its safe range (e.g. pages 1–8),
   **Then** Save is refused and the range is shown.
6. **Given** a text longer than 8,000 characters, or empty, **Then** Save is
   refused with the reason.
7. **Given** another user's account, **Then** none of this user's edits apply
   there.

---

### User Story 3 — Rules that can't be edited away (Priority: P1)

Some rules always apply, whatever the user edits:

- Never apply, message anyone, sign in or change a site's settings.
- Never save a job or mark one applied.
- Never copy or send the job text.
- Stop at a CAPTCHA, a login wall or an error.

These are sent to Claude after the user's main steps, on every run. The tool
descriptions and the app's step-by-step replies are also locked, because the
app's logic depends on their exact wording.

**Why this priority**: Editing must never be able to make Claude do something
the user didn't intend.

**Independent Test**: Delete every line of the main steps except one and save.
Preview still ends with the locked rules.

**Acceptance Scenarios**:

1. **Given** any edit of the main steps, **When** a run starts, **Then** Claude
   gets the user's main steps followed by the locked rules.
2. **Given** the locked sections, **When** the user tries to change them in any
   way (including through the app's web addresses), **Then** nothing changes.

---

### User Story 4 — Preview what Claude would get (Priority: P2)

For any saved search, Preview shows exactly what Claude would be given if the
search started now: every text, the scoring, the limits, the search link (or
"Claude picks the titles" for a broad search), without starting anything.

**Why this priority**: It closes the loop after an edit: the user sees what
will really be sent.

**Independent Test**: Pick a search in Preview; the page shows the brief with
the current instructions. No run is created.

**Acceptance Scenarios**:

1. **Given** a saved search, **When** Preview is opened, **Then** it shows the
   brief as Claude would get it, and no run starts.
2. **Given** an edit, **When** Preview is opened again, **Then** it shows the
   edit.

---

### User Story 5 — The run log: what Claude and the app said (Priority: P1)

Each run in History has a **Log**: every call Claude made during the run, in
order, with the time, what Claude sent and what the app answered. It's in plain
words first ("Checked 25 jobs on page 2: 6 new, 12 seen before, 7 titles didn't
fit"), with the full detail behind a tap. When Claude read the resume, the log
says so, but never shows the resume. Each run also says which instructions it
used (original, or edited on a given date).

**Why this priority**: This is how the user finds out what "got messed up":
whether Claude followed the steps, skipped pages or got an error.

**Independent Test**: Run a search; open it in History → Log. Each step shows
in order with its time; tapping one shows the detail; a failed step shows the
app's error.

**Acceptance Scenarios**:

1. **Given** a run, **When** Claude calls any Scout tool, **Then** the log gets
   an entry with the time, the tool, a one-line summary, what Claude sent and
   what the app answered.
2. **Given** a call the app refused (e.g. a search page link, too many rows),
   **Then** the entry shows the refusal message.
3. **Given** the brief, **Then** the log shows its settings but refers to the
   instruction texts by name and version instead of repeating them.
4. **Given** Claude reads the resume during a run, **Then** the log says "Read
   your resume" and stores none of it.
5. **Given** a long run, **Then** the log keeps at most 400 entries and each
   entry's detail is capped in size, so it stays fast on a phone.
6. **Given** another user, **Then** they can't see this user's log.
7. **Given** a run, **Then** History shows which instructions it used, e.g.
   "Main steps: edited Nov 21 · Scoring: original".

---

### Edge Cases

- **A run started before an edit:** it keeps using the instructions it started
  with, even in a new chat.
- **A run from before this feature:** it has no log and no instruction record;
  History says "No log for runs before Nov 21".
- **The original texts change in an app update:** sections that aren't edited
  follow the new original; edited ones keep the user's text, and the section
  says "The original changed since you edited this" with a way to compare.
- **Tool not tied to a run** (e.g. saving a job by hand through the
  connector): not logged.
- **Edits on two devices at once:** the later save wins, and both are in
  history.
- **Text that looks like code or a web page:** shown as plain text, never run.

## Requirements *(mandatory)*

### Functional Requirements

**Seeing**

- **FR-001**: Claude Scout MUST have an Instructions tab showing: main steps,
  extra steps (Google Jobs, Local companies, Anything I'd be good at), scoring
  weights, limits, the locked rules, and every Scout tool's description.
- **FR-002**: Each editable section MUST show whether it's original or edited
  (with the date).

**Editing**

- **FR-003**: The user MUST be able to edit, per account:
  - the main steps and the three sets of extra steps (each 1–8,000
    characters)
  - the five scoring weights (whole numbers 0–10, adding up to 10)
  - results pages per run (1–8), titles per broad run (2–8) and companies per
    Local run (5–25)
- **FR-004**: Each editable section MUST have Save, Reset to original, and a
  history (latest 20 versions) with Restore.
- **FR-005**: Edits MUST apply only to the user's own runs started after the
  save.

**Locked**

- **FR-006**: The locked rules MUST be sent after the user's main steps on
  every run, and MUST NOT be changeable by the user.
- **FR-007**: Tool descriptions and the app's step-by-step replies MUST be
  shown read-only.

**Per run**

- **FR-008**: Each run MUST use the instructions as they were when it was
  started, including in a new chat.
- **FR-009**: History MUST show which instructions a run used (original or
  edited, with the date).

**Preview**

- **FR-010**: Preview MUST show, for any of the user's searches, the brief
  Claude would get if it started now, without creating a run.

**Log**

- **FR-011**: Every Scout tool call tied to a run MUST be logged with: time,
  tool, a plain one-line summary, what Claude sent, what the app answered (or
  its refusal).
- **FR-012**: The log MUST NOT store the resume or repeat the instruction
  texts; it refers to them by name and version.
- **FR-013**: A run's log MUST keep at most 400 entries, each at most 8,000
  characters of detail, and is removed with its run.
- **FR-014**: The log and the instructions MUST be visible only to their
  owner.

**Everywhere**

- **FR-015**: All user text MUST be shown as plain text.
- **FR-016**: Everything MUST work the same on a phone as on a computer.

### Key Entities

- **Instruction version**: one saved version of one editable section for one
  user (main steps, an extra-steps text, scoring, limits). It records when it
  was saved, and whether it's a reset to the original. The latest one is the
  current one.
- **Run's instructions**: on each run, which version of each section it used.
- **Log entry**: one tool call in one run. It records the time, the tool, a
  summary, what was sent (trimmed) and the answer or refusal (trimmed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every piece of text Claude is given at the start of a run is
  visible on the Instructions page or in Preview; nothing it gets is missing
  from the page.
- **SC-002**: The user can change the main steps and see the change in Preview
  in under 1 minute.
- **SC-003**: After any edit, 100% of new runs still end their main steps with
  the locked rules.
- **SC-004**: For any finished run, the user can find which step went wrong
  (or confirm none did) from the log in under 2 minutes, on a phone.
- **SC-005**: The resume never appears in any log entry.

## Assumptions

- The originals are the texts in the app's code; this feature doesn't change
  them except to move the always-apply rules out of the main steps into the
  locked section, and to have the main steps refer to the brief's scoring
  instead of repeating the weights.
- Limits not listed as editable stay fixed and are shown read-only: how long
  titles that didn't fit are remembered (30 days), when titles rest (3 empty
  runs, 14 days), re-checks of local companies (7 days, at most 3 a run).
- The log covers Scout tools only. Other connector tools aren't logged, except
  the note that the resume was read during a running search.
- History keeps the latest 20 versions per section.

## Out of scope

- Editing a search's own settings (already on each search).
- Editing tool descriptions or the app's replies.
- Sharing instructions with other users, or a version for friends' accounts.
