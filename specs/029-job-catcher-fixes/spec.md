# Feature Specification: Job Catcher fixes

**Feature Branch**: `029-job-catcher-fixes`

**Created**: 2026-11-25

**Status**: Built (2026-11-25): one PR, Job Catcher 0.43.0

**Input**: The owner's bug report from a real Apply with Claude run on Workday (a guest apply on an engineering firm's Workday site, Job Catcher 0.42.0):

1. Work history was filled from the **master** résumé's PDF text, not the run's picked résumé: line breaks mid-sentence, a sentence cut and the next bullet glued on, bullet marks lost, the last point cut mid-word.
2. `resume: no_box` on "My Experience" though Workday's résumé box was there.
3. On page 2 the fill report listed page 1's boxes (Workday keeps one address for every step), also on retry.
4. The phone number went into "Phone Extension".
5. Claude's tab left its tab group mid-run (new tabs from "Apply on company website" and "Apply now").
6. New: when Claude fills a box Job Catcher couldn't, learn it once the user approves, so Job Catcher fills it next time.

## User Scenarios & Testing

### User Story 1 - The right job history, in whole sentences (P1)

During a run, the jobs and schools Job Catcher types come from the résumé picked for the run. A résumé Claude wrote is read from its own text, never the master's. Wrapped PDF lines are joined back into their sentence; points split only at a bullet mark or a real sentence end; bullets keep their "•"; nothing is cut mid-word.

**Acceptance**: a job's résumé saved by Claude has its own jobs (title, company, bullets as written); one saved before this fix is read again from its document the first time Job Catcher asks, unless the user edited its details; a PDF's wrapped bullets read back as whole points.

### User Story 2 - Workday's résumé box is found (P1)

Workday's hidden file input (inside its drop zone or beside it in the upload card), labelled "Upload a file (5MB max)" under a "Resume/CV" heading, is the résumé box. If Workday's drop zone ignores the file set on the box, the file is dropped on the zone.

**Acceptance**: both layouts on the lab pages get the résumé; a "Cover Letter" box stays a cover letter; a dropdown is never taken for a drop zone.

### User Story 3 - Each step reports only its own boxes (P1)

A fill's report (the panel's review and Claude's `fill_page`) lists only boxes on the page now. When Keep filling is already filling the step, Claude's fill waits for that fill's report instead of handing back the last step's.

### User Story 4 - Never the phone in Phone Extension (P1)

A box named Extension / Ext (label, Workday id, or `tel-extension`) never gets the phone number. "Phone number (with extension)" is still the number's box.

### User Story 5 - Claude stays in one tab (P2)

The playbook tells Claude to open apply links in the same tab (read the `href`, navigate; a hidden or redirect address too). Job Catcher never switches tabs (or restores a window) for a photo while the user is acting, in any window; it never makes, moves or groups tabs.

### User Story 6 - Learning from Claude's runs (P2)

When the user approves the review (Submit, or "I'll press Submit myself"), each answer Claude wrote (`claude: true`) or picked (`guess: true`) for a box Job Catcher didn't fill is saved to Autofill memory, marked **From Claude**, editable and deletable there. Never learned: passwords and private numbers, self-ID, agreements, essays (essay questions or answers over 300 characters), salary and one company's questions, the user's own details (name, contact, address, links, schools, jobs, dates), any answer the user changed or asked about at a review or that changed between rounds. An answer the user already has is never replaced.

## Out of scope

- Re-reading master résumés already stored with the old reader (the user can press "Read my résumé" in the app; edited details must never be overwritten).
- Resolving LinkedIn's hidden apply link inside Job Catcher.
