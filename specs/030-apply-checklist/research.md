# Research: one checklist, edit while it fills, problems report

## R1. How a mid-fill change reaches Claude

- **Decision**: an unread conversation message with a `fix` field (`{q, a, to | ask}`), added by `POST /runs/{id}/live-fix`.
- **Why**: Claude already gets unread messages in every tool result as `from_user` (spec 023), and the review bubbles' `fixes` (spec 026) already have this shape. No new tool, no polling, and the user sees it in the conversation too.
- **Rejected**: a separate `live_fixes` list (a second inbox to keep in sync); reusing the review `decision` (only exists at the review).

## R2. Questions: extend a tool or add one

- **Decision**: extend `ask_questions` with `guess`, `choices`, `only_you`, and allow it while filling. Each call starts a new `batch` (or joins the open one).
- **Why**: it already keeps answers as things told to Claude, has an app card and a chat path (`user_said`). `need_help` stays for single blocking things (sign in, CAPTCHA, a file).
- **Back to the right step**: after the answers, a run that already has a résumé (or pages) goes back to filling; otherwise to writing the résumé.

## R3. Where problems live

- **Decision**: a JSON list column `apply_runs.problems`.
- **Why**: problems belong to one run, are few (≤20) and are read with the run. The admin list reads recent runs (60 days, ≤300 runs) and flattens them; fine at this scale (developer + friends).
- **Rejected**: a table (more code for a list that is never queried on its own fields).

## R4. Keeping problems safe

- Kind must be one of fill / job_catcher / tab / resume / site / other (else other).
- Text: one line, ≤500 chars; "password/pin/token/otp… is|:|= X" → "[removed]"; long letter+digit strings, card numbers and SSNs removed.
- Page: scheme + host + path only (queries carry tokens).
- Same text and kind again → `count` + 1; past 20 → not kept, Claude told to carry on.
- The run's owner sees their own (run view); only `require_admin` sees everyone's.
