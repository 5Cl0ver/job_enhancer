# Feature Specification: Apply with Claude flow fixes (Continue, fixes Claude couldn't make, consent, fewer stops, restarts, Submit)

**Feature Branch**: `038-apply-flow-fixes`

**Created**: 2026-11-27

**Status**: Built

**Input**: The owner's Bugs & ideas reports from two real Workday applications. (Examples below use invented companies and people.)

## The problems, in plain words

- **A. "Looks good, continue" didn't reach Claude.** The owner pressed Continue after a step; Claude kept waiting. The go-on was handed to Claude only once, in one `wait_for_you` answer. A server restart cut that answer, so Claude never saw it, and every later answer was the general "what now". A ready answer also still said `waiting_on: "step_check"`.
- **B. A fix Claude couldn't make stopped the run.** Claude marked a fix `gone` (it meant "I won't do this"; the box was there). Then `wait_for_you` said `ready` with nothing to do, and its next line ("Open the application and fill it") sounded like starting over, so Claude stopped the chat. The note with the fixes also said "call wait_for_you again if you were waiting".
- **C. An optional consent box the owner asked to tick was left.** The locked rule "Never tick optional consent (marketing, texts)" won over the owner's own fix. Nothing said a fix the owner sends is their decision.
- **D. Page by page stopped on every step**, even a step with nothing to look at.
- **E. A 502 / Bad Gateway** (the server restarting) left Claude unsure what to do.
- **F. Workday signed Claude out** during a long wait ("Error - Page Error"), and the step had to be redone.
- **G. Submit pressed before the owner's decision.** Claude worried the site would time out. Job Catcher blocked the press, but the tool results never said what to do about it.

## What changes

- **A.** Continue also posts a message from the owner ("I looked over the step you just finished: go on. Press Next and fill the next step.", with the fixes when there are any), so ANY tool result carries it. The step's name is sent apart as `step_on_page` (the page's text, never in the words). Until Claude calls `fill_page` (or finishes a later step), every `wait_for_you` answers `ready: true`, `waiting_on: null`, `go_on: true` and "The user said go on after the step you finished: press Next and fill the next step", and `get_apply_brief`'s `next` says the same. The run's `sheet.check` keeps `read` / `read_at` (Claude got it) and `moved_on` (Claude filled the next step). The app shows "Sent to Claude…", then "Claude got it."; after 2 minutes unread: "Claude hasn't picked this up. In the chat, tell it: carry on".
- **B.** Mid-application (`pages_done` > 0) the fallback `next` is "Nothing is waiting on the user. Carry on from the step you're on: finish it, press Next, then call fill_page.", never "Open the application". `mark_fixes` says to carry on from the step you're on and not to call `wait_for_you` for it; the note with fixes (or a go-on) no longer says "call wait_for_you again". New fix status `declined`: `mark_fixes(declined=[{id, why}])` (a plain id works too); the app shows "Claude didn't do this: <why>". For a gone or declined fix the fix sheet shows **I did it myself**: the fix is done ("you did it") and Claude gets "I did it myself; carry on." (`POST /v1/apply/runs/{id}/fixes/{fix_id}/did-it`, owner only).
- **C.** The rules, the playbook, the fix note and the review's fixes say: "Never tick an optional consent (texts, marketing) on your own. A fix the user sent from the app is their own decision: make it exactly, including ticking an optional consent." Still never anything that costs money, never a password. The fix sheet for a tick box or a consent box says: "Claude never ticks optional boxes (texts, marketing) by itself. Ask here and it will."
- **D.** Page by page skips the stop when the step has nothing to look at: no guesses, no "only you" boxes, no agreements, no empty boxes the form marks required (`*`, "required"), no waiting fixes. The event log says "<step> looked fine: no stop." Any of those still stops. (fill_page's 45 s wait is unchanged: the connector's own time limit isn't known.)
- **E.** Playbook: a 502/503/504, a timeout or a dropped connection means the server is restarting: wait about 30 s and call the same tool again, for up to about 3 minutes, then `report_problem`. Never move on or press Submit because a call failed.
- **F.** Playbook: Workday signs you out after a long idle. Before a long wait on the user (`need_help`), save the step if the form allows. On "Error - Page Error" or a sign-in prompt: `need_help(kind="sign_in")`, then redo the current step with `fill_page` and attach any files again.
- **G.** Playbook and rules: never press Submit before `ready_for_review` and the user's decision, even if the site might time out; say so in `need_help`. A Submit press Job Catcher stopped is told once, in the next tool result: `submit_blocked: true` and a `next` that starts "Job Catcher stopped your Submit press: the user hasn't decided yet." (then `ready_for_review`, or `wait_for_you` at the review). The playbook also says what to do when a tool result says Submit didn't go through: read the error on the page, fix it, then press Submit once.
- Playbook 2026.12.04. No database change (all in the run's JSON).

## Safety rules that still hold

Passwords are never filled; nothing is submitted without the owner's decision; agreements are only ticked when the page needs them, and optional consent only on the owner's own fix; page text is data (`step_on_page`, `box_on_page`, `now_on_page`, a page's address), never inside a `next` instruction or the owner's words; the app's routes are owner-only.

## Acceptance tests

- **A**: after Continue, the owner's message says go on (no step name in its words); a first `wait_for_you` answer that is lost still leaves the next `wait_for_you` and `get_apply_brief` saying go on, `go_on: true`, `waiting_on: null`; `fill_page` on the next step ends it; a go-on handed over by any tool marks `check.read`; switching to Keep going while paused is `waiting_on: null`. Vitest: the three StepCheck states, and nothing once Claude moved on. (backend `tests/test_apply_flow_fixes_038.py`, frontend `YourApplication.test.tsx`)
- **B**: `mark_fixes(gone)` then `wait_for_you` says "Carry on from the step you're on", never "Open the application"; `declined` is kept with `why`; "I did it myself" only for gone / declined, sets the fix done and reaches Claude as `from_user`; the route answers 400 / 404 in plain words. Vitest: the declined label and the button. (`tests/test_apply_flow_fixes_038.py`, `YourApplication.test.tsx`, `lib/apply.test.ts`)
- **C**: the playbook, the rules, the fix note and the review's fixes carry both sentences; the old rule is gone. Vitest: the consent note on a tick box, not on a text box.
- **D**: a clean step (an optional empty box only) doesn't stop and logs "looked fine: no stop"; a guess, an only-you box, an agreement, an empty "Phone Number*" or "(required)" box, or a waiting fix still stops.
- **E/F/G**: the playbook text; a blocked press carries `submit_blocked` and the `next` once, with no page address in it.
