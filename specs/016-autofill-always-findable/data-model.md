# Data model: Autofill you can always find

There are no server or database changes. Everything lives in the extension.

## FormPresence (one per frame, reported by the content script)

| Field | Type | Meaning |
|---|---|---|
| `form` | boolean | The frame has a form worth filling (research R2) |
| `fields` | number | Visible fillable fields (a count only, never values) |
| `app` | boolean | It also passes the application check (a person field is recognised, or the address is an applicant system) |
| `inModal` | boolean | The fields are inside an open pop-up |
| `at` | number | When it was measured (ms) |

**Held by the background** in `chrome.storage.session` under `je_form:<tabId>` → `{ [frameId]: FormPresence }`.
- Cleared when the top frame navigates (`tabs.onUpdated` status `loading` with a URL change), and when the tab closes.
- A frame whose `form` becomes false is removed from the map.

**Derived per tab:**
- `tabHasForm` = any frame has `form`.
- `tabLooksLikeApplication` = any frame has `app`, or `detectContext(url).kind === "application"`.

## Badge state (per tab)

| State | Badge | Colour | When |
|---|---|---|---|
| none | "" | — | no frame has a form |
| ready | "⚡" | primary | `tabHasForm` |
| done | count (e.g. "12") | green | 4 s after a successful fill, then back to ready |
| error | "!" | amber | 4 s after a failed press, then back to ready/none |

## ApplicantHost (static list, `src/autofill/hosts.js`)

| Field | Type | Meaning |
|---|---|---|
| `host` | RegExp | Host pattern |
| `path` | RegExp? | Optional path that must also match |
| `name` | string | Friendly site name for the panel ("Paycom") |
| `autoTracked` | boolean | Submit tracking is known to work (existing meaning) |

## Fill status (per tab, shown in the panel)

`je_status:<tabId>` in `chrome.storage.session`:

| Field | Type | Meaning |
|---|---|---|
| `phase` | `"looking" \| "ready" \| "none" \| "filling" \| "done" \| "problem"` | What the status line says |
| `done` / `total` | number | Progress while filling (fields written / fields planned) |
| `problem` | `"signed_out" \| "asleep" \| "refresh" \| "slow" \| "nothing_matched"`? | Why it stopped |
| `at` | number | Last change (ms). The panel's 20 s watchdog uses it |

**Transitions:**
- `looking` → `ready` (presence found a form) or `none`.
- `ready` → `filling` (press) → `done` or `problem`.
- `done` → `filling` (Fill again, or keep filling on a new step).
- Any phase → `looking` when the tab navigates.
