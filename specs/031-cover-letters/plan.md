# Implementation Plan: Cover letters, like résumés

**Branch**: `031-cover-letters` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

## Summary

Mirror the résumé pieces, kept light: Claude writes the letter through the connector, the app stores it as a written document, draws it in the résumé's look, lets each job pick one, and Job Catcher fills it into cover-letter boxes.

## Decisions

- **R1, storage:** a `generated_documents` row with `document_type = "cover_letter"` (the type already existed). No file column: the PDF is drawn on demand (a one-page letter is quick), so an edit never leaves a stale file.
- **R2, the tool:** a new `save_cover_letter` rather than a `kind` on `save_resume`. A résumé pauses for a review and moves the run's step; a letter does neither, and its rules differ. Its own tool keeps both simple.
- **R3, the look:** `render_letter_pdf(header, body, date)` reuses the résumé template's header (name, title line, contact, navy rule), then the date and plain paragraphs. The header is the job's made résumé's when there is one, else the profile's.
- **R4, the stiff openings** are refused by the tool as well as forbidden by the playbook, so a slip is fixed before it's saved. The check strips markdown and skips a leading "Re:", name, contact or date line; it blocks "Dear …", "To whom it may concern", "I am / I'm writing to express/apply", "Hi team / there / hiring manager" and a bare "Greetings,", and allows "Hi <Name>," / "Hello <Name>,". `save_draft` applies the same rules to a cover letter.
- **R5, which letter:** the job's pick (`saved_jobs.cover_letter_id`) is the one truth. Claude's save sets it only when the job has no letter yet and this run hasn't saved one, or when the job's letter is still this run's earlier one; so the user choosing another letter, or None, wins even mid run (Claude's new text is still kept on its letter, and Claude is told it won't be attached). `apply_runs.cover_letter_id` only records the letter Claude wrote, so a second save replaces it. Job Catcher reads the pick from `/v1/apply/active` on the run's tab, else from the saved-jobs summary.
- **R6, Job Catcher:** a file box is the letter's only when it isn't the résumé's and its own label, the text before it, or its heading says cover letter; a text box when its own label does. One fetch (`/v1/autofill/cover-letters/{id}`: text + PDF as base64), fresh for every fill (a re-save or an edit keeps the id, so a kept copy could be old). A text box gets the letter only when its label is mainly "cover letter" (short, starts with it, no "optional" / "not needed"), and only when the whole letter fits; a box's group or heading naming a cover letter makes it never the résumé's, even as the page's only upload.
- **R7, token cost:** the playbook gains one short block; the letter is written only when a page asks for one.

## Technical Context

| | |
|---|---|
| **Storage** | Migration `z4c5d6e7f8a0` (down_revision 030's `y3b4c5d6e7f9`): `saved_jobs.cover_letter_id`, `apply_runs.cover_letter_id`, FK → `generated_documents` SET NULL, both indexed. |
| **Testing** | pytest (tool, PDF via pdfplumber, routes, migration round trip + offline Postgres SQL); vitest (picker, card); extension vitest (boxes, text fill) and Playwright (lab page `cover-letter.html`) |
| **Constraints** | $0, phone-first, no AI in the app, owner-only files |

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ |
| II. User-centric | ✅ The letter the owner wants (no "Dear …"), picked per job, filled for them. |
| III. AI | ✅ Claude writes; the app draws and fills. |
| IV. Security | ✅ Owner-only routes, size caps, no tokens in URLs. |
| V. Tests | ✅ |
| VI. Clean architecture | ✅ One service (`cover_letters.py`), one component file. |
| VII. Simplicity | ✅ No new table, no stored files, no review step. |

## Structure

```text
backend/app/services/cover_letters.py        # rules, save, pick, list, the PDF
backend/app/services/resume_pdf.py           # render_letter_pdf
backend/app/services/apply_runs.py           # save_cover_letter, view/brief/extension state
backend/app/mcp_server.py                    # the save_cover_letter tool
backend/app/apply/playbook.md                # when and how to write one
backend/alembic/versions/z4c5d6e7f8a0_cover_letters.py
frontend/src/components/jobs/JobCoverLetterPicker.tsx  # picker + CoverLetterCard
frontend/src/hooks/useCoverLetters.ts
extension/src/autofill/resolve.js            # isCoverLetterUpload / isCoverLetterText
extension/src/background/autofillCopy.js     # fetch the letter
```
