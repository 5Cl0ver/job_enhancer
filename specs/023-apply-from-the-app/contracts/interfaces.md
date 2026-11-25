# Contracts: Apply from the app

## Connector tools (changes)

| Tool | Change |
|---|---|
| every apply tool | The result includes `from_user: [{text, at}]` (unread messages, then marked read) when there are any. Each call stamps `claude_at`. |
| `need_help(run_id, kind, what, choices?)` | `choices`: up to 4 short quick answers. Also asks Job Catcher for a "screen now" photo (no wait). |
| `wait_for_you(run_id)` | Waits up to 45 s. Returns `reply` (the user's quick answer or typed text) with help. Returns early with `from_user` when a message arrives. |
| `message_user(run_id, text)` **new** | Posts a short update in the app's conversation. Returns `from_user`. |
| `get_apply_brief` | Adds `messages` (the conversation so far) and `job_catcher` (version, seen, ready). |

## REST `/v1/apply` (changes)

**New (app):**
- `POST /runs/{id}/messages {text}`: posts the user's message (≤1000).
- `POST /runs/{id}/peek`: asks for a "screen now" photo. 409 if one is already waiting.

**Changed (app):**
- `POST /runs/{id}/help-done {reply?}`: sends the reply (a quick answer or typed text) with keep going.
- `POST /runs/{id}/sent`: also allowed while `submitting`.
- `POST /runs/{id}/not-sent`: back to the review from `submitting`, with "It wasn't sent".

**Changed (Job Catcher):**
- `POST /runs/{id}/event {kind: "confirmation_seen", url, words}`: ends a submitting (or submit/self review) run as sent, confirmed.

**Run view:**
- adds `messages`, `peeks: [{id, at}]`, `claude_at`, `claude_stopped` (bool), `ask_if_sent` (bool), `job_catcher {version, last_seen_at, ready, needs}`, `help.choices`, `help.reply`, `review.confirmed`.

## Job Catcher (0.41.0)

| Piece | Behaviour |
|---|---|
| `peek` request | One shot of the tab as it is. The same tab checks as photos; no scroll. |
| Confirmation watch | After a Submit press in the run's tab, the top frame scans the page text every 2 s for 20 s. On a match it sends `applyConfirmed {words}`; the background sends a peek-like photo, then the `confirmation_seen` event. |
| Panel | The app's own origin is never "an application". |
| `clean()` | Decodes HTML entities. |
