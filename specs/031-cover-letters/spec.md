# Feature Specification: Cover letters, like résumés

**Feature Branch**: `031-cover-letters`

**Created**: 2026-11-25

**Status**: Approved to build (owner, 2026-11-25)

**Input**: The owner, 2026-11-25:
> "cover letter also with this résumé, same things the résumé is in each one: I can view, I can choose ones attached to the job, etc. Should be easy, it doesn't need a lot. I hate some of the 'Dear blah blah'."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claude writes a short letter, only when it's needed (Priority: P1)

During Apply with Claude, when the application has a cover-letter box (an upload or a text box), or the user asks for one, Claude writes a short letter for the job and saves it with `save_cover_letter`. It becomes the job's cover letter.

The letter:
- is 3–4 short paragraphs, under about 250 words;
- opens with a direct line about the role. Never "Dear Sir/Madam", "To whom it may concern" or "I am writing to express my interest". "Hi <name>," only when the hiring manager's name is known; otherwise no greeting;
- is specific to the job and true to the master profile (never invented);
- ends with a plain sign-off and the user's name.

**Acceptance:**
1. `save_cover_letter` with "Dear Hiring Manager," is sent back with a plain reason; a good letter is saved on the job.
2. Saving again in the same run replaces that letter. A letter the user picked is never written over.
3. No cover-letter box and no request: no letter is written (the playbook says so).

### User Story 2 - See it in the résumé's look (Priority: P1)

The letter is a PDF in the same look as the job's résumé: the same header (name, title line, contact, navy rule), then the date and the letter. It opens in the app's viewer, with Download.

**Acceptance:**
1. The letter's PDF has the résumé's navy name and rule, the date, then the letter, with the sign-off on its own lines.
2. With no résumé made for the job, the header comes from the profile (name, city, phone, email, LinkedIn).

### User Story 3 - Pick the letter for each job (Priority: P1)

On the job page, next to "Résumé for this job": **Cover letter for this job**. Pick one of your letters (this job's first) or **None**, **View** it, **Edit text** (the PDF is remade). On the application page, a small **Cover letter** card shows the letter that goes with it, to view or change.

**Acceptance:**
1. Picking a letter saves it on the job; None clears it.
2. Edit text saves the user's text; the PDF shows it.
3. The picker is hidden until the user has a cover letter.

### User Story 4 - Job Catcher uses it (Priority: P1)

Job Catcher attaches the job's letter to a clearly cover-letter upload box (its label, or the text or heading just before it, says cover letter), and pastes its text into a text box whose label is mainly "cover letter". Never the résumé box. The job's pick is the one truth: Claude's save sets it, and the user choosing another letter (or None) wins, even during a run. A text box too small for the whole letter is left ("Too long for this box"), never cut off. No letter: the boxes are left for the user (or Claude).

**Acceptance:**
1. On a page with a résumé box, a cover-letter card and a "paste your cover letter" box, the résumé goes in its box and the letter in the other two.
2. With no letter, both cover-letter boxes are left empty.

### Edge Cases

- A box for "résumé and cover letter" together is neither: never a guess.
- A letter written in the app's Write tab (or saved with `save_draft`) is a cover letter too, and can be picked.
- Deleting isn't needed: None unpicks.

## Requirements *(mandatory)*

- **FR-001:** MCP tool `save_cover_letter(run_id, content)`; size caps (150–4,000 characters, about 330 words at most); the stiff openings and `[placeholders]` are refused with a plain reason.
- **FR-002:** The letter is a `generated_documents` row of type `cover_letter`; its PDF is drawn on demand by the résumé template (`render_letter_pdf`). The user's edits are capped at 10,000 characters.
- **FR-003:** `saved_jobs.cover_letter_id` and `apply_runs.cover_letter_id` (SET NULL). Routes: `GET /v1/ai/cover-letters`, `PUT /v1/saved-jobs/{id}/cover-letter`, `GET /v1/autofill/cover-letters/{id}` (Job Catcher: text + PDF). Owner-only; no tokens in URLs.
- **FR-004:** Job Catcher 0.44.0: the letter in cover-letter boxes only.
- **FR-005:** No AI in the app: Claude writes through the connector.

## Success Criteria *(mandatory)*

- **SC-001:** On the next application with a cover-letter box, Claude writes a letter with no "Dear …", and Job Catcher attaches it.
- **SC-002:** The owner views, edits and picks a job's letter on their phone.
- **SC-003:** All existing tests pass; new tests cover the tool, the PDF, the routes, the migration, the picker and card, and Job Catcher's boxes.
