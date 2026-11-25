# Implementation Plan: Résumés you can see, shape and talk over

**Branch**: `025-resumes-you-can-see` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

> **Status: plan only.** Nothing is built until the owner answers the open decisions below.

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
- **R6, token cost:** the playbook gains one example layout (about 40 lines) and a few rules. Each revision is one `save_resume` call, the same as today.

## Technical Context

| | |
|---|---|
| **Languages** | Python 3.11, TypeScript/React 19 |
| **Dependencies** | fpdf2 (exists), `pdfjs-dist` (new, frontend, lazy), FastAPI, TanStack Query |
| **Storage** | `users.review_resumes` (bool, default true): one additive migration. A new run status value (no schema change) |
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
backend/alembic/versions/…_review_resumes.py
frontend/src/components/common/PdfViewer.tsx       # lazy pdfjs, pages, zoom, Download
frontend/src/components/apply/ResumeReview.tsx     # the review card
frontend/src/components/settings/ResumesCard.tsx   # view instead of open-in-tab
```

**PRs:**
- **A:** the template and the viewer, used everywhere. This is safe on its own.
- **B:** the review step and the playbook rules.

## Open decisions for the owner

1. **Job résumé length:** "every job kept, trimmed to 2 pages at most" (proposed), or 1 page?
2. **Review step:** on by default, with a setting to turn it off (proposed)?
3. **Core areas boxes:** keep them on job résumés too (proposed: only when they fit the job), or master only?
