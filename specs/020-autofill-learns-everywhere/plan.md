# Implementation Plan: Autofill that learns everywhere, plus the section bugs

**Branch**: `020-autofill-learns-everywhere` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

The research found three root causes:
- The free AI model was **retired on 2026-11-05**, so the user's résumé was never read: 0 jobs stored.
- Learning is **site-scoped**.
- The **profile beats learned answers**.

The fixes, in delivery order:

**PR 1, "Learns everywhere + résumé details"** (US1, US5, US6 data side):
1. No AI (R1): résumés are read by the built-in reader only, and Autofill's AI pass is off behind one flag. The retired model is left for the later AI phase.
2. A built-in résumé reader (the only reader), details editable per résumé, backfill of unread résumés, and a **Read my résumé** button (R2, R7).
3. Learning everywhere: canonical `@key` answers, the new fill order, section-aware preferred-name classification, the identity guard, typing-over learning, the pointer default "Every site" plus **Only this site**, and promotion of existing taught answers (R3).
4. Résumé per job: `saved_jobs.resume_id`, the job page picker in the app, "Filling from … · Change" in the panel, and the chosen résumé's file uploaded (R7).

**PR 2, "Sections, dropdowns, skills, languages"** (US2, US3, US4, US6 fill side):
5. The dropdown driver: one at a time, verified, closed (R5).
6. The section filler, with Workday, Greenhouse, SuccessFactors and generic adapters: Add rows, correct pre-filled values, Undo, dates (R4).
7. Skills (search prompts and text boxes), languages in the profile and the app, the level ladder (R6).

## Technical Context

**Stack**:
- Python 3.11: FastAPI, SQLAlchemy async, Alembic, httpx, langchain-nvidia.
- TypeScript/React 19: Vite app and Job Catcher panel.
- JavaScript ES2022: extension content and background scripts.

**Storage** (Postgres, one migration per PR):
- PR 1: `saved_jobs.resume_id`. `custom_answers` is unchanged; `@key` lives in `question_key`.
- PR 2: `application_profile.languages` (JSON). `resumes.parsed_history` keeps its JSON column with new keys.

**Testing**:
- pytest (parser formats, model fallback, routes, pass allowlist).
- Vitest (resolve order, canonical keys, promotion, identity guard, level ladder, driver).
- Playwright MV3 lab pages:
  - cross-site learning;
  - Workday Work Experience with wrong pre-fills and Add;
  - Workday Languages and skills with stacked-popup checks;
  - Greenhouse rows;
  - SuccessFactors-style preferred name.

**Constraints**:
- $0.
- Press-only, Super autofill and never-submit unchanged.
- Undo for everything.
- Invented test data only.
- Spec 019 security rules.
- No `chrome.debugger`.

## Constitution Check

| Principle | Status |
|---|---|
| II. User-centric | ✅ "Answer once, never again"; résumé details visible and editable |
| III. AI degrades gracefully | ✅ No AI in this feature: everything works without it (built-in reader, Needs you), as the owner asked |
| IV. Security | ✅ New routes are session-only unless needed; owner checks; guards for self-ID, consent and passwords kept; pass allowlist updated deliberately |
| V. Tests | ✅ Each root cause gets a failing test first (410 model, Jaccard 0.67 wording, profile-before-learned order, site-only save) |
| VII. Simplicity | ✅ Canonical keys reuse `custom_answers`; no embeddings; no debugger |

## Files (main touch points)

**Backend**
- `app/config.py`, `app/services/ai_service.py`: model chain and think-strip.
- `app/services/resume_reader.py` (new): the built-in reader.
- `app/services/resume_history.py`: AI then built-in, plus skills, certifications and websites.
- `app/api/v1/autofill.py`: résumé details GET/PUT, résumé fetch.
- `app/api/v1/saved_jobs.py`: job résumé link.
- `app/main.py`: the scheduler backfill job.
- `alembic/versions/*`.
- `tests/api/test_pass_routes.py`.

**Extension**
- `src/autofill/classify/answers.js`: canonical keys, fuzzy tiers.
- `src/autofill/resolve.js`: order.
- `src/autofill/classify/profileKeys.js`: section-aware classification.
- `src/autofill/session.js`: `typedAnswers`, fill order, section filler hook.
- `src/autofill.entry.js`: pick, saveable, scope.
- `src/background.entry.js`: the `picked` save to `@key` or the question; promotion; résumé choice; copy.
- `src/background/autofillCopy.js`: the chosen résumé file and details.
- PR 2: `src/autofill/widgets.js` (driver), `src/autofill/sections/*` (new, replaces `workday.js`).
- Panel: `views/Point.tsx` (Every site / Only this site), `views/Apply.tsx` (Filling from…).
- `test/lab/*`, `e2e/*`.

**Frontend**
- `components/autofill/ResumeDetailsCard.tsx` (new).
- `components/jobs/JobResumePicker.tsx` (new, on `JobDetailPage`).
- `SavedAnswersCard` labels ("Every site" for `@key`).
- PR 2: `LanguagesCard`.

## Risks

- **Workday tenants vary.** Selectors come from working open-source tools, not a spec. The generic adapter and "for you" fallbacks cover misses, and the lab pages cover the known shapes.
- **Promotion with mixed sites:** the identity guard and section check keep the Workday "first name" row from leaking into legal names. There's a test with the owner's exact four label/answer pairs (invented answer value).
- **The model chain may also go stale.** The admin health check shows which model answered, and a 410 logs clearly.
