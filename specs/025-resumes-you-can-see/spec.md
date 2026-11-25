# Feature Specification: Résumés you can see, shape and talk over

**Feature Branch**: `025-resumes-you-can-see`

**Created**: 2026-11-25

**Status**: Draft (plan only; the owner decides before anything is built)

**Input**: The owner, 2026-11-25, with their master résumé (Luis_Fabian_Montufar_Master_Resume.pdf, 3 pages):
> "I need to be able to view résumés without having to download them. Download is fine, but it should be an option. I wanna review, and then when applying also, and if I review it I want to change things or be able to talk to Claude through the app on what I should change, before it adds it to the résumé."
>
> "The résumé should look like this, looks-wise and template, not all plain like it has been."
>
> "This is a master that it will ask me more stuff if needed to add, or it will debloat it to fit the job I'm applying to."

**What the master looks like** (read from the PDF itself):
- **Page:** US Letter, margins about 0.6 in (43 pt), Carlito (Calibri's twin) throughout.
- **Header:** a navy (#1E3A8A) banner with the name (24 pt bold) and a small "MASTER RESUME" tag. Under it:
  - a bright-blue (#2563EB) title line (11.5 pt bold): "Systems Engineer · Identity, Endpoint, Microsoft 365, Azure & Automation · Full-Stack Developer";
  - grey (#4B5563, 9.6 pt) contact lines, separated by "·".
- **Section headings** (10.5 pt bold navy caps) sit on full-width light-blue (#BFDBFE) bars.
- **Core areas:** four light-grey (#F8FAFC) boxes side by side, each with a bold navy title and a short list.
- **Technical skills:** a two-column table, with a bold navy label on the left and the items on the right, and thin grey (#E5E7EB) lines between rows.
- **Experience:** the job title in bold near-black (11 pt), then "·" and the company, with the dates right-aligned in grey. Blue bold sub-headings group the bullets inside a job ("Identity, access & lifecycle", "Azure, integrations & migrations"…). Bullets are indented 11 pt.
- **Projects, Certifications** (name · issuer, date right), **Education**, **Additional** (bold labels inline).
- **Footer:** "Master Resume · page 1 of 3", right-aligned in grey 8.5 pt.

**What the app does today:**
- **Résumé PDFs** (from the "Write" tab and Claude's `save_resume`) come out as plain black text with a thin rule under each heading.
- **Opening a résumé** opens it in a new browser tab. On many phones that means a download.
- **Apply with Claude** saves the job's résumé and goes straight on to the application. There is no review step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See any résumé in the app (Priority: P1)

Every résumé, the master included, opens in a **viewer inside the app**, on the phone and the computer:
- Pages are drawn on screen, and you can zoom.
- **Download** is a button in the viewer, never the only way.

It's used everywhere a résumé is shown: Settings › Résumés, a job's "Résumé for this job", the application page, and documents on a job.

**Acceptance:**
1. On a phone, tapping a résumé shows its pages in the app; nothing downloads.
2. The viewer's Download button saves the file.
3. A Word (.docx) résumé shows "This file can't be shown here; download it" with the button.

### User Story 2 - Made résumés look like the master (Priority: P1)

Résumés and cover letters the app makes (Claude's, and the Write tab's) are drawn in the master's template: the same colors, banner, section bars, core-areas boxes, skills table, job headers with dates on the right, blue sub-headings, and page numbers.
- A job's résumé carries no "MASTER RESUME" tag. Its footer reads "Page 1 of 2".
- Résumés made before this keep working: the old layout is a subset of the new one.

**Acceptance:**
1. Claude's résumé for a job opens in the viewer looking like the master: navy banner, blue title line, blue section bars, the skills table, and dates on the right.
2. A résumé written in the old layout still renders, now in the new look.

### User Story 3 - Review the job's résumé before Claude uses it (Priority: P1)

After Claude writes the job's résumé, the run **pauses at "Review your résumé"** (on the phone or the computer). The page shows the résumé in the viewer and four choices:
- **Use it:** Claude goes on to the application.
- **Change something:** you write what to change ("cut the projects", "lead with Intune"). Claude rewrites it, and it's shown again.
- **Ask Claude:** the conversation (spec 023) is right there. "What should I change for this job?" gets Claude's suggestions before you decide.
- **Edit it yourself:** the text editor (the PDF is remade).

A setting, **Review résumés before Claude applies**, is on by default. Turned off, Claude goes straight on, like today.

**Acceptance:**
1. With the setting on, after `save_resume` the run waits at "Review your résumé" and Claude waits (`wait_for_you`).
2. "Change something: cut the projects" reaches Claude. It saves a new version, and the review shows the new one.
3. "Use it" lets Claude carry on to the application.

### User Story 4 - The master is the source; each job gets a lean version (Priority: P1)

- **The master stays the user's file.** It's chosen in Settings › Résumés (exists) and viewable (Story 1).
- **For each job, Claude builds from the master:**
  - It **keeps every real job, school and certification**, so nothing is ever invented or dropped.
  - It **cuts the bloat** for this job: the skills and bullets that don't matter here, and the long sub-groups. It aims for **2 pages at most**.
  - It **asks** about what the listing wants that the master doesn't show (exists).
- The answers are kept as things you told Claude (exists), so the master grows without editing the PDF.

**Acceptance:**
1. A job résumé from a 3-page master is 2 pages or fewer, has every employer and school, and has no section the job doesn't need, and has no Core areas boxes.
2. Nothing in it is missing from the master or from your answers.

### Edge Cases

- **Uploaded résumés:** the master and any uploaded résumé are shown exactly as they are, never re-drawn.
- **Long job titles or company names** wrap. Dates never overlap them.
- **A job résumé that runs past 2 pages:** it's saved anyway, but Claude is told to trim it and save again.

## Requirements *(mandatory)*

- **FR-001:** An in-app PDF viewer (pages, zoom, Download) for every résumé and document PDF, phone and computer.
- **FR-002:** One PDF template matching the master. It reads the existing Markdown layout plus small additions:
  - a `> title line`;
  - `### Group` under a job (blue sub-heading);
  - `## CORE AREAS` with `### Box` + a line each;
  - `**Label:** items` lines drawn as the skills table.
- **FR-003:** Résumé review step: the run pauses after `save_resume` when the setting is on. The review is decided with `use` / `change` (note); edits are allowed; Claude revises with `save_resume`.
- **FR-004:** The playbook's résumé rules:
  - keep every real role, school and certification;
  - tailor and trim for the job;
  - 2 pages at most;
  - the template layout above;
  - never invent anything.
- **FR-005:** No AI in the app; Claude writes. The viewer and template are code.

## Success Criteria *(mandatory)*

- **SC-001:** The owner views the master and a job résumé on their phone without a download.
- **SC-002:** A job résumé made after this looks like the master (owner's judgment, side by side).
- **SC-003:** On the next Apply with Claude, the owner reviews and changes the résumé from the app before Claude applies.
- **SC-004:** All existing tests pass. New tests cover the template (layout pieces, page count, old Markdown), the viewer, and the review step.
