# Implementation Plan: see everything, fix at the end

**Branch**: `033-apply-fix-at-end` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

## Summary

The server keeps one **sheet** per run: steps → rows (question, answer, tag, choices). It's merged from Job Catcher's live ticks and from `page_done`, so the app's list keeps growing and never repeats. Fixes become a **waiting tray** stored on the run and are delivered at checkpoints: Continue (Page by page), the end (Keep going), or Send now. Job Catcher sends choices and a step name. The playbook drops "finish the page again" and learns the modes and the company check. The stall check counts live page changes as activity.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11, TypeScript/React 19, JS (Job Catcher) |
| **Primary Dependencies** | FastAPI, SQLAlchemy async, Alembic, FastMCP; TanStack Query, shadcn/ui |
| **Storage** | `apply_runs` gains `sheet` JSON (default `{}`), `fixes` JSON (default `[]`), `mode` text (default `page`), `paused_step` text null. One migration after the head at build time |
| **Testing** | pytest (sheet merge, dedupe, fixes lifecycle, modes, stall rule, refusals return `next`, migration); vitest (Your application list, fix sheet choices, tray, step check, review dedupe); extension vitest (`pageAnswers` sends choices and step); Playwright on the Workday lab page (steps, choices) |
| **Constraints** | Old Job Catcher versions keep working (no choices = text box); no AI in the app; the Submit lock is unchanged |

## Constitution Check

| Principle | Status |
|---|---|
| II. User-centric | ✅ One list, no interruptions, real choices, the owner's chosen default mode. |
| III. AI | ✅ Claude's judgment through the connector; the app stays AI-free. |
| IV. Security | ✅ Choices and page text stay data (`box_on_page`, fenced); caps on choices, fixes and rows; owner-only routes. |
| V. Tests | ✅ Each story has a test; redone-page and pop-up regressions are pinned. |
| VI/VII | ✅ The sheet logic lives in one new module, `apply_sheet.py`; it reuses the message inbox for delivery. |

## Design

### Sheet (`backend/app/services/apply_sheet.py`, new)
- **Shape:** `sheet = {"steps": [{"key", "title", "n", "rows": [{"q", "a", "tag", "by", "options"?, "fixed"?}] }]}`.
  - The step `key` is the normalized step label from Job Catcher (`step`), else the page title, else `page-{n}`.
  - Caps: 30 steps, 120 rows per step, 60 options of 120 characters.
- **`merge_live(run, live)`:** upsert rows into the current step by question (case-folded). It never deletes rows when a pop-up narrows the scan.
- **`merge_page(run, page)`:** upsert from the finished page's answers and Job Catcher's answers, with tags from the flags.
- **`rows_to_check(run)`:** guesses, empties and "only you", each once.
- **Review:** the frontend `checkFirst` and the page lists read `run.sheet`, not raw `pages`. `latestPages` becomes a merge by step. Raw `pages` and photos stay for proof.

### Fixes (`apply_runs.py`)
- **`add_fix(run, step, q, to|ask)`:** the box must be in the sheet (any step), not just the live view.
  - A fix's status is `waiting`, `sent`, `done` or `gone`.
  - Up to 30 waiting fixes per run.
  - It replaces `live_fix`'s immediate send.
- **Delivery:** `deliver_fixes(run, scope)` turns waiting fixes into one `you` message with `fixes: [{box_on_page, now_on_page, step, to|ask}]` (the page text stays apart, as in 030).
  - Page by page: on **Continue**, the fixes for that step.
  - Keep going: on `ready_for_review`, all waiting fixes, before the review opens. Claude applies them, then calls `ready_for_review` again.
  - Send now: the route `POST …/fixes/send`.
- **Done:** a fix is marked done when the sheet row's value changes to the wanted value. If its step was done and the box is no longer there, it's `gone`.

### Modes
- `mode` is set from the start step and changed with `PATCH …/mode`.
- **Page by page:** `page_done` returns `{"next": "Call wait_for_you: the owner is checking <step>."}` and sets `paused_step`. The app shows the step check. **Continue** (`POST …/continue`) delivers the step's fixes, clears `paused_step`, and `wait_for_you` wakes Claude.
- **Keep going:** `page_done` returns "Go on to the next step."
- `_claudes_turn` is false while `paused_step` is set, so there are no stall warnings during a check.

### Not stopping
- **`claude_stopped`:** activity = the latest of `claude_at`, user events, and `live_changed_at` (set in `save_live` when the boxes differ from the last tick). The limit is 3 minutes normally, 8 minutes while `filling`.
- **Refusals:** `_not_while_checking`, ask-in-needs-you, and similar return `{"ok": false, "next": "…"}` from the connector instead of raising. Real errors (an ended run, not the owner's) still raise.
- **Job Catcher waits:** `wait_request` waits up to 45 s and re-queues once on `no_answer` (fill only), with the result told as "still filling, call fill_page again" rather than a failure.
- **Brief:** for a run started off-site, `next` says "Open `apply_url` in this same tab." `_add_host` also accepts the host Claude reaches by redirect from the apply URL (as today).

### Company check
- The brief returns `job.company`. The playbook says: when the form or its header names a different company, `message_user` the note, `report_problem(kind="site")`, and use the page's employer for company-specific answers unless the owner says otherwise.

### Job Catcher (0.46.0, after 034's 0.45.0)
- `applyPage.pageAnswers` adds `options: optionLabels(f)` (capped) and the page's `step`: the Workday progress bar's current step (`[data-automation-id="progressBar"] [aria-current="step"]`), else the main heading.
- `save_live` and `_answers` keep `options` and `step`.

### App
- **`components/apply/YourApplication.tsx`** (replaces `LiveFill`): steps as collapsible groups, header counts, tags, a tap opens `FixSheet`.
- **`FixSheet`** (Bubbles.tsx, shared): choices as buttons, with search when over 8; a text box when there are no choices; Ask Claude.
- **`FixTray`**: server-backed waiting fixes (`useFixes`), edit and remove, Send now.
- **`StepCheck.tsx`**: the "<step> is done: look it over" card with that step's rows and **Continue**.
- **`ModeSwitch`**: on the Start step and in the run header.
- **Review:** reads the sheet, shows one row per question, and shares the tray.
- **Playbook** version `2026.12.02` (playbook.md, rules.md): modes, fixes at checkpoints, one tab, best judgment with marks, the company check, and never "page_done again just to apply a fix" (only when a step was actually changed).

## Project Structure

```text
backend/alembic/versions/<id>_apply_sheet_fixes_mode.py   new
backend/app/models/apply.py                               sheet, fixes, mode, paused_step, live_changed_at
backend/app/services/apply_sheet.py                       new
backend/app/services/apply_runs.py                        fixes, modes, stall, refusals, brief next
backend/app/mcp_server.py                                 refusal shapes, page_done next, docs
backend/app/api/v1/apply.py, schemas/apply.py             fixes, continue, mode routes; live options/step
backend/app/apply/playbook.md, rules.md, apply_playbook.py
frontend/src/components/apply/{YourApplication,StepCheck,ModeSwitch}.tsx   new
frontend/src/components/apply/{Bubbles,Review,LiveFill}.tsx                FixSheet choices; review from sheet; LiveFill removed
frontend/src/lib/apply.ts, hooks/useApply.ts
extension/src/autofill/applyPage.js, background/applyRun.js; manifest 0.46.0
```

## PR

One PR. The pieces depend on each other: the sheet feeds the list, the review and the fixes. It goes after 034 has merged (Job Catcher versions in order).
