# Implementation Plan: Job Catcher fixes

**Branch**: `029-job-catcher-fixes` | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Six fixes from a real Workday run, one PR, Job Catcher 0.43.0. No AI inside the app; the server only reads text with rules.

## Technical context

FastAPI + SQLAlchemy (backend), React (frontend, one card), MV3 extension (vanilla JS content scripts, background worker). Tests: pytest, Vitest (happy-dom), Playwright against the fake server and lab pages.

## Changes

| Area | Files |
|---|---|
| Reader: whole sentences, bullets kept, no mid-word cut | `backend/app/services/resume_reader.py` |
| A Claude résumé's details from its own text; old ones read again once | `backend/app/services/apply_resume.py`, `backend/app/api/v1/autofill.py`, `backend/app/api/v1/ai.py` |
| Learning from Claude (approved answers → Autofill memory, "From Claude") | `backend/app/services/apply_learn.py` (new), `backend/app/services/apply_runs.py`, `backend/app/models/custom_answer.py`, `backend/app/schemas/user.py`, `backend/app/api/v1/users.py`, migration `y3c5e7a9b1d2_custom_answer_source` |
| Playbook: one tab, honest marks (version 2026.11.29) | `backend/app/apply/playbook.md`, `backend/app/services/apply_playbook.py` |
| App: "From Claude" line | `frontend/src/components/settings/SavedAnswersCard.tsx`, `frontend/src/hooks/useCustomAnswers.ts` |
| Workday résumé box, drop fallback | `extension/src/autofill/scan.js`, `resolve.js`, `widgets.js` |
| Current step only | `extension/src/autofill/session.js`, `extension/src/background/applyRun.js` |
| Phone Extension | `extension/src/autofill/classify/profileKeys.js` |
| Never the master's history in a run | `extension/src/background.entry.js` |
| No tab switch while the user acts | `extension/src/background/applyRun.js` |
| Lab pages matching the real DOM | `extension/test/lab/apply-workday.html`, `extension/test/lab/apply-workday-steps.html` (new) |

## Constitution check

- Security: learning never stores passwords, private numbers, self-ID, agreements or pay; the user's own answers are never replaced; everything learned is visible and deletable. Lab pages and tests use invented people and companies.
- Tests first for each bug: each new test fails on the old code (checked).
- Simplicity: one new column, one small service; no new endpoints.

## Risk

- Migration `y3c5e7a9b1d2` follows `x2a3b4c5d6e8`; another branch adding a migration on the same parent needs a merge revision.
- The drop fallback is limited to Workday's own zone and only when its page doesn't show the file.
