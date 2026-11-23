# Quickstart: checking the Job Catcher overhaul (015)

Everything here runs on invented pages, an invented person ("Wren Calloway") and a fake app server. No real sites, accounts or data are used, and `extension/config.js` is never changed.

## Prerequisites

- Node 20+, with `cd extension && npm ci`
- Playwright Chromium: `npx playwright install chromium`
- Backend virtualenv for the API tests: `backend/.venv`

## Run the checks

```bash
cd extension
npm run build              # dist/ from src/
npx vitest run             # unit: scan, labels, classify, resolve, answers, widgets, Workday dates
npx playwright test        # browser: the built extension in real Chromium vs test/lab + fake API
```

The browser tests open a visible Chromium window, because MV3 extensions need one. In CI they run under `xvfb-run`.

```bash
cd backend && .venv/Scripts/python -m pytest tests/api/test_autofill_bundle.py tests/api/test_scout_save_anyway.py tests/api/test_ai_autofill_map.py -q
cd frontend && npm run test -- ScoutSaveAnyway
```

## What the browser tests prove (one or more specs per scenario)

| Scenario | Expected |
|---|---|
| Classic, React, shadow, embedded-frame pages: press Autofill | Every field Wren has an answer for holds the right value in the **page's own data**. Confirm email is filled. Search dropdown options are really selected. Pressing to filled takes under 1 s. |
| Fake server delays every reply by 30 s | Still filled in under 1 s from the copy |
| No copy yet + slow server | The pill says "Waking up the app…", then fills |
| Noise page | No pill |
| Prefilled page | Typed values unchanged |
| Sensitive page | Self-ID, consent and essay untouched |
| Review | Panel lists every entry. Fix changes the page's data. Undo and Undo all restore. |
| Learn | Answer an unknown question, press Next, then Save in the panel; a reworded twin on another page fills blue |
| Workday 4-step | One press; each step fills as it appears. 3 experience blocks + education with dates that hold. Self-ID step untouched. |
| AI | A confident answer fills purple; an unsure one is a suggestion only; with AI down, nothing else changes |
| Keyboard shortcut | Fills like the button |
| Regression | Save button on the board fixtures; capture; Scout copy; submit, then mark-applied called |
| Update | Tab open, then the extension reloads, then the Scout copy still works with no tab refresh |

## Live try (the user, after each merged PR)

1. In `chrome://extensions`, press reload on Job Catcher **once**. After PR A, later updates take over open tabs by themselves.
2. Open the side panel and check you're signed in.
3. Try one real application you were going to do anyway, for example Workday or Greenhouse:
   1. press **⚡ Autofill**;
   2. open **Review**;
   3. fix anything wrong;
   4. answer the orange ones;
   5. press Next and save the offered answers;
   6. submit **yourself**.
4. In Scout Results, press **Save anyway** on a "Not copied" job. Open its posting and check that My Jobs gets the full description.
