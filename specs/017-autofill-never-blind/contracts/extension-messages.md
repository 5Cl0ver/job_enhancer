# Contract: extension messages (017 additions)

## Panel → background

| Message | Reply | Does |
|---|---|---|
| `readAgain {tabId}` | `{frames, fields}` | Runs `chrome.scripting.executeScript({target:{tabId, allFrames:true}, injectImmediately:true, files:["dist/autofill.js"]})`. Each frame then rescans with the full rules and re-reports `formPresence`. |
| `scanReport {tabId}` | `{report}` | Asks every frame for its report and merges them, adding the version and host. The panel copies it on the user's press. |
| `startPick {tabId}` / `stopPick {tabId}` | `{ok}` | Relays to all frames. |
| `fillPicked {tabId, frameId, fieldId, profile_key? , answer?, remember}` | `{ok, actual}` | Fills the picked box through the normal writer. If `remember` is set, saves the taught entry: `POST /v1/autofill/taught`, then refreshes the copy. |

## Background → content (each frame)

| Message | Reply |
|---|---|
| `scanReport` | `{frameId, host, found, kept, dropped, fields[]}`, never values |
| `startPick` | none. The frame enters pointing mode. |
| `stopPick` | none |
| `fillPicked {fieldId, values}` | `{ok, actual}` |

## Content → background

| Message | Meaning |
|---|---|
| `picked {field:{id,label,kind,options}, fingerprint}` | The user clicked a box in this frame. The background tells the other frames `stopPick` and broadcasts `pickChanged` to the panel. |
| `pickCancelled` | Esc on the page |

## Press flow change (spec 016's `pressAutofill`)

If every reply reports `fieldsSeen: 0`:
1. Run `readAgain`.
2. Press again once.
3. Only then write the result status.

The status note reads "Looking deeper…".
