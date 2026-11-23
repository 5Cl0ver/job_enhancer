# Extension messages (content ⇄ background ⇄ side panel)

The background stays the only API caller. Every message is `{type, ...}`, and every reply is `{ok, ...}`.

## Content script (any frame) → background

| type | payload | reply |
|---|---|---|
| `getAutofillCopy` | – | `{signedIn, copy, resume: {filename, mime, b64} \| null, waking?: bool}`. Served from storage. `waking` is true only when there's no copy yet and the server is being woken. |
| `aiMapFields` | `{fields:[{id,label,type,options}], step}` | `{mappings, confidence}` |
| `sessionUpdate` | `{site, step, entries, need_you, suggestions}` | `{ok}`. Stored under the sender's `tab.id`/`frameId`, then `sessionChanged` is broadcast. |
| `answersNoticed` | `{answers:[{question_key, question_text, answer}]}` | `{ok}`. Appended to `pending_answers`, deduped by key. |
| `profileNoticed` | `{fields:{first_name?, last_name?, phone?, address_line1?, city?, state?, postal_code?, country?, linkedin_url?, github_url?, portfolio_url?, authorized_to_work?, requires_sponsorship?, willing_to_relocate?, desired_salary?, notice_period?}}` | `{ok}` — only keys whose typed value differs from the copy; held as `pending_profile` |
| `openReview` | – | `{ok}`. `chrome.sidePanel.open({tabId})`, sent from the pill's click. |
| `saveCustomAnswers`, `markAnswersUsed`, `markApplied` | as today | as today |

## Background → content script (one frame or all frames of a tab)

| type | payload | effect |
|---|---|---|
| `runAutofill` | `{keepFilling}` | every frame with fields runs the instant tier, then the AI tier |
| `applyFix` | `{entryId, value}` | write + read back; reply `{ok, actual}` |
| `undo` | `{entryId}` or `{all:true}` | restore snapshots; reply `{undone}` |
| `show` | `{entryId}` | scroll into view + flash |
| `useSuggestion` | `{id}` | write the suggestion; it becomes an AI entry |
| `setKeepFilling` | `{on}` | – |

Each frame answers only for the entry ids it owns. The panel addresses frames by the `frameId` recorded in the session.

## Side panel ⇄ background

| type | payload | reply |
|---|---|---|
| `getFillSession` | `{tabId}` | the merged session (all frames) |
| `sessionChanged` | `{tabId}` | sent by the background; the panel re-reads if it's showing that tab |
| `panelAction` | `{tabId, frameId?, action, ...}` | relayed to the frame(s) as above |
| `savePendingProfile` | `{tabId, fields}` | `PUT /v1/users/me/application-profile` (merge onto current), clear pending, refresh copy |
| `savePendingAnswers` | `{tabId, answers}` | `PUT /v1/users/me/custom-answers`, then removes them from pending and refreshes the copy |

## Commands (manifest `commands`)

`autofill` has the suggested key `Alt+Shift+F`, which the user can change in `chrome://extensions/shortcuts`. On this command the background sends `runAutofill` to all frames of the active tab.
