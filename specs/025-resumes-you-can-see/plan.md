# Implementation Plan: Résumés you can see, shape and talk over

**Branch**: `025-resumes-you-can-see` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

> **Status: approved to build** (2026-11-25). The owner's decisions are at the bottom.

## Summary

Three pieces:
1. An **in-app PDF viewer**, so no résumé needs a download.
2. A **PDF template** that draws the app's résumés like the owner's master.
3. A **résumé review step** in Apply with Claude: view it, ask Claude, change it, edit it, then "Use it".

Claude keeps writing the résumé. The app only draws it and pauses.

## Research (decisions)

- **R1, the viewer:** PDF.js (`pdfjs-dist`, Mozilla) draws pages onto canvases in the app.
  - Why: browsers can't show a PDF inline everywhere. Android Chrome downloads it, and iPhone Safari shows only the first page in a frame. PDF.js works the same everywhere.
  - It's loaded only when the viewer opens (Vite lazy import plus its worker), so the app doesn't get slower.
  - Rejected: an `<iframe>` (fails on phones); re-drawing the résumé as HTML (it can't show uploaded PDFs as they are).
- **R2, the template:** extend the existing fpdf2 maker (`services/resume_pdf.py`), which already uses Carlito.
  - fpdf2 has fills, rectangles, colors, cells and per-page footers, which is everything the master uses.
  - Colors and sizes are measured from the master (spec), and kept as constants in one place.
- **R3, the layout Claude writes:** the existing Markdown plus 4 small additions (FR-002). Old résumés still render, since the additions are optional. The playbook shows Claude the full example layout.
- **R4, the review step:** a new run status `resume_review`, between "writing" and "filling".
  - `save_resume` returns "wait for the user's review" when the setting is on.
  - `wait_for_you` returns `use` or `change` (+ note).
  - The app's review card has the viewer, Use it, Change something, and the conversation and editor (both exist).
  - This reuses spec 022/023's review and message machinery; there's no new connector tool.
- **R5, the setting:** stored on the user (a small boolean), editable in Settings and on the review card ("Don't ask me next time"). On by default.
- **R7, picking a résumé first (Story 5):** `POST /v1/apply/runs {saved_job_id, resume_id?}`. With a résumé, the run starts with `resume_id` set and `resume_picked` true, and the job's résumé is set to it. The brief says `resume_picked: true`, and `_what_now` already sends Claude to filling when a résumé is set, so the run skips questions, writing and the review. The app's Apply with Claude button opens a small sheet with the three choices (the résumé list is the existing `/v1/ai/resumes`).
- **R6, token cost:** the playbook gains one example layout (about 40 lines) and a few rules. Each revision is one `save_resume` call, the same as today.

## Technical Context

| | |
|---|---|
| **Languages** | Python 3.11, TypeScript/React 19 |
| **Dependencies** | fpdf2 (exists), `pdfjs-dist` (new, frontend, lazy), FastAPI, TanStack Query |
| **Storage** | Migration `v0e1f2a3b4c6` (after 024's `u9d0e1f2a3b5`): `users.review_resumes` (bool, default true) and `apply_runs.resume_picked` (bool, default false). A new run status value `resume_review` (no schema change) |
| **Testing** | pytest: the template's PDF (page count, text order, fonts and colors via pdfplumber, old Markdown), the review flow tools. vitest: the viewer (mocked pdfjs), the review card |
| **Constraints** | $0, phone-first, no AI in the app, existing résumés keep working |

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ |
| II. User-centric | ✅ No downloads to look; it looks like their résumé; review before use. |
| III. AI | ✅ Claude writes; the app draws. |
| IV. Security | ✅ Files are served owner-only as today; the viewer draws from an authenticated blob. |
| V. Tests | ✅ |
| VI. Clean architecture | ✅ |
| VII. Simplicity | ✅ One template, one viewer component, one status. **PDF.js is justified:** a viewer that works on phones can't be done in 10 lines. |

## Structure (when built)

```text
backend/app/services/resume_pdf.py          # the template (header banner, section bars, skills table, core areas, job headers, sub-groups, footer)
backend/app/services/apply_runs.py          # resume_review status, review decision (use/change)
backend/app/apply/playbook.md               # résumé rules + the example layout
backend/alembic/versions/v0e1f2a3b4c6_resume_review.py
frontend/src/components/apply/ApplyWithClaudeButton.tsx  # Which résumé?
frontend/src/components/common/PdfViewer.tsx       # lazy pdfjs, pages, zoom, Download
frontend/src/components/apply/ResumeReview.tsx     # the review card
frontend/src/components/settings/ResumesCard.tsx   # view instead of open-in-tab
```

**PRs:**
- **A:** the template and the viewer, used everywhere. This is safe on its own.
- **B:** the résumé choice at the start, the review step, and the playbook's résumé rules (2 pages, trimmed, the layout).

## Decisions (owner, 2026-11-25)

1. **Job résumé length:** 2 pages at most. Every job, school and certification is kept; the skills and bullets that don't fit the job are cut.
2. **Review step:** on every time, with a setting to turn it off.
3. **Core areas boxes:** master only, never on job résumés.
   - **Why:** reading the owner's master with a PDF text reader mixed the four boxes' words across columns ("Entra ID, AD, SSO, RBAC, Windows 10/11 imaging, Exchange, SharePoint, PowerShell, Python…"). Applicant tracking systems read side-by-side boxes the same way and get garbled text.
   - The boxes also repeat the skills table and cost space against the 2-page limit.
   - The template still draws them for a résumé that has them (the master's style); the playbook tells Claude not to write them for a job.
