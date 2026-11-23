# Contract: extension messages (016 additions)

The spec 015 messages are unchanged unless noted here.

## Content script → background

### `formPresence`

`{ type: "formPresence", presence: FormPresence }`

- Sent by every frame when its presence changes (debounced to 300 ms), and once on load if `form` is true.
- The background stores it under `je_form:<tabId>[sender.frameId]`, updates the badge, and broadcasts `{ type: "formPresenceChanged", tabId }`.

### `fillProgress`

`{ type: "fillProgress", done, total }`

- Sent by a filling frame at most every 150 ms.
- The background updates `je_status:<tabId>` (summed over frames) and broadcasts `statusChanged`.

(The on-page pill and its `pressAutofill` sender are removed: the user decided there is no page button.)

## Panel / command / toolbar → background

### `pressAutofill`

`{ type: "pressAutofill", tabId }` → `{ ok, filled, need, signedIn?, unreachable?, noForm? }`

The press flow:
1. Read `je_form:<tabId>`. Target the frames with `form: true`. If there are none, target frame 0 (the shortcut still works on any page).
2. If a target frame has `inModal: true`, target only frames whose fields are in the modal.
3. Send `runAutofill { force: true }` to each target with `{ frameId }`, in parallel, and sum the replies.
4. Flash the badge: done or error.

The Alt+Shift+J command and the panel button both use this flow. The toolbar icon click keeps opening the side panel.

## Background → content script

### `probeFill` (changed)

Sent when the panel opens on a tab with no stored presence: `{ type: "probeFill" }`.
- Each frame re-measures and replies through `formPresence`; it does not reply directly.
- The background answers the panel with the stored map after 300 ms.

### `runAutofill` (changed)

`{ type: "runAutofill", force?: boolean }`. With `force`, a frame fills if `hasForm()` is true, even when the application check fails.

## Background → panel

### `formPresenceChanged`

`{ type: "formPresenceChanged", tabId }`. The panel re-reads `getFormPresence`.

### `getFormPresence`

`{ type: "getFormPresence", tabId }` → `{ form: boolean, app: boolean, frames: number }`

## Panel: shortcut

`chrome.commands.getAll()` → the `autofill` command's `shortcut`.
- An empty string shows "Set a shortcut".
- The link opens `chrome://extensions/shortcuts` via `chrome.tabs.create`.
