# Research: Apply with best judgment

## R1: Why the résumé wasn't attached (live run 2fcfe2a7, read only)

- The fill requests on Workday's "My Experience" filled 32 boxes, and their "still needs an answer" list had no résumé box.
- `scan.js` only counts a file input when it, or a `label` / `[class*=drop|upload]` around it, is visible. Workday's input is hidden, and its drop zone is named by `data-automation-id="file-upload-drop-zone"` (class names are random), so the box was never seen. That's why it was neither filled nor reported.
- Separately, the résumé came from `resumeFor(tab)`, which guesses the saved job from the page's address. The job was saved from LinkedIn and the application is on Workday, so the guess can miss.
- **Decision:**
  1. A hidden file input counts when an ancestor (up to 4 levels) is visible and holds a visible button or link reading "Select files / Upload / Browse / Attach / Choose file", or carries a `data-automation-id` with "upload" or "drop".
  2. During an open run, a page on the run's site uses the run's résumé (`/v1/apply/active` adds `resume_id`).
  3. The nearby text includes the section's heading ("Resume/CV" on Workday), so the box is recognised as the résumé's. The press-only and "clearly résumé" rules stay.
- **Rejected:** attaching to any file box on the page (could put the résumé in a cover-letter box).

## R2: Why photos failed

- `captureVisibleTab` only photographs the tab showing in a window. `stillShowing` (rightly) refuses any other tab, so every request ended "not_visible".
- **Decision:** before the photos:
  - If the run's tab isn't active in its window, make it active (`tabs.update({active:true})`). This doesn't focus the window or take the keyboard from another app.
  - If the window is minimised, restore it (`windows.update({state:"normal"})`).
  - Wait for a paint (~350 ms), take the photos with the same "still showing" checks, then put back the tab that was showing (only if the run's tab is still the one showing, so a user who switched on purpose isn't overridden) and minimise again if it was.
  - When capture still fails: `chrome.idle.queryState` tells "locked" (no photo possible) from "active" (the user is working elsewhere; don't raise Chrome over their app). Either way the page's questions and answers are kept as text.
- **Rejected:**
  - The `debugger` permission (CDP screenshots of background tabs): a scary install warning, a "being debugged" bar, and it can clash with Claude in Chrome's own debugger.
  - Focusing the window over other apps: takes the user's keyboard.

## R3: The live view without tokens

- Job Catcher already reads every box and its value (`__jecAutofill.answers()`, used for the photos' answers). It works in background tabs (it reads the page, it doesn't draw it).
- **Decision:** while the run's status is `filling` (or `needs_you`), the background loop reads the run's tab every 3 s, and when the snapshot changed, posts `{url, title, boxes:[{q,a,by}]}` to `POST /v1/apply/runs/{id}/live`.
  - `by` is "job_catcher" for boxes Job Catcher filled this page (from its fill report), else blank.
  - The app's run query already refetches every few seconds while a run is open; it shows `live`.
- **Token cost:** zero. Claude isn't involved.
- **Rejected:** having Claude report each box (tokens per box), and screenshots every few seconds (heavy, and needs the tab showing).

## R4: Best judgment, and where it must stop

- **Decision:** the playbook's step 4 changes from "ask about anything you can't answer truthfully" to "decide, mark the guess, move on", with a locked list of stops:
  - sign-in / sign-up (passwords);
  - CAPTCHA;
  - a file Job Catcher couldn't attach;
  - facts about the user: experience, years with X, degrees, licences, certifications, work authorisation, sponsorship, clearance, criminal history.
- `page_done` answers gain `guess: true` (Claude's judgment, not a fact from the profile) and `agreement: true` (a box ticked to agree).
- Required agreements are ticked and listed at the review. Optional consent (marketing, SMS) stays unticked. The final Submit is always the user's (spec 022), which is the real consent point.
- Self-ID: the saved answer, else the decline option; marked as a guess.
- Pay: the user's saved desired salary, else the posting's range midpoint; marked as a guess.

## R5: Bubbles and batched fixes

- The review already has every page's answers. **Decision:** show them as bubbles, ordered agreements → guesses → empty → Claude wrote → the rest, with a source chip.
- Tapping a bubble opens a small sheet: **Change it to** (text, or the page's options when Job Catcher knows them) or **Ask Claude**.
- The tray sends one `fix` decision with `fixes: [{page, q, a, to?, ask?}]` and a note made from them, so old Claude chats (which read only `note`) still work.
- `wait_for_you` returns `fixes`. The playbook says: make each change, answer each question with `message_user`, call `page_done` for changed pages, then `ready_for_review`.

## R6: Plain problems

- Fill results gain `resume: attached | no_box | no_file | failed`. Photo results gain a reason code.
- The server turns them into one-line plain words for Claude (`tell_user`) and the app.
- `need_help(kind="file")` is a new kind. The app's card for it shows **Download your résumé for this job** (the run's résumé) and the reason.
