# Research: Autofill that never goes blind

There were two research passes on 2026-11-23:

1. Why a scanner sees zero fields in a visible pop-up, and the most reliable way to read any page. Sources: Chromium, MUI v4 source, Chrome docs.
2. Pickers you hover and click, and tools that let a user teach a field. Sources: uBlock Origin epicker, @medv/finder, Bitwarden, Lightning Autofill, Simplify/Jobright help, Chrome APIs.

Sources are listed at the end.

## R1. Why the Paycom pop-up gave zero fields

**Finding:** Our visibility test was wrong. `scan.js` dropped every element inside `[aria-hidden=true]`, `[inert]` or `[hidden]`. `aria-hidden` is an **accessibility** attribute ("hide from screen readers"), not a visibility signal.

MUI v4's `ModalManager` (which Paycom's own UI library is built on) sets `aria-hidden="true"` on every child of `body` except the modal's mount node. The dialog itself ends up under that attribute when:
- it's rendered with `disablePortal` or a container inside `#root` (so `#root`, which holds the dialog, is hidden);
- modals are nested: the +1 country picker, Select, Menu and Popover are all modals in MUI v4;
- a `keepMounted` modal is involved;
- the `aria-hidden` npm package's `hideOthers` is used.

A filter that checks ancestors drops **every** field at once, which is exactly the "zero fields, nothing listed" result.

**Second trap:** MUI v4 radios and checkboxes are real `<input>`s with `opacity: 0` sitting on top of their drawn icon. Select uses a hidden `input.MuiSelect-nativeInput` beside a visible `div[role=button]`. A test that rejects anything fully transparent would also drop the SMS Yes/No and the privacy box.

**Decision:** Visibility is judged only by rendering (R2). `aria-hidden` and `inert` are used only to **rank** fields, never to drop them. This is not yet confirmed on Paycom's own code, which needs a client-specific address. The lab reproduces MUI v4's real behaviour (R7), and the scan report (R5) will confirm it on the real page in one paste.

## R2. A visibility test that never misses an on-screen field

**Decision:** Use Chrome autofill's own rule (`IsWebElementVisible`: focusable plus a non-trivial size). It never looks at `aria-hidden`.
- **Drop only:** `type=hidden`; `disabled`; fields where `checkVisibility({visibilityProperty: true})` is false (no box, `content-visibility: hidden`, `visibility: hidden`); and fields with no client rect.
- **Fully transparent or tiny inputs** (radio, checkbox, a native select under a custom one): judge their visible stand-in instead. That is the `<label>`, the nearest `role=button` / `role=radio` / ButtonBase ancestor, or the sibling `[role=button]` (this extends the existing `choiceVisible`).
- **`aria-hidden`, `inert`, `aria-modal` and hit-testing only rank:** the topmost visible pop-up first (spec 016's pop-up scope), then fields in view.
- **Fallback where `checkVisibility` is missing:** computed style plus rects (the current code without the ancestor rule).

**Rationale:** Chrome's autofill marks fields as focusable or visible but never throws them away for accessibility attributes. `elementFromPoint` and IntersectionObserver are good for ranking but bad for excluding (fields below the fold).

## R3. Reaching every frame on demand: "Read the page again"

**Decision:**
- **Manifest:** add `match_origin_as_fallback: true` and `match_about_blank: true` to the autofill content script, so frames the page creates without an address (`about:blank`, `srcdoc`, `blob:`) get the script.
- **Read again / zero-field press:** the background calls `chrome.scripting.executeScript({target: {tabId, allFrames: true}, injectImmediately: true, files: ["dist/autofill.js"]})`.
  - This re-injects a fresh copy wherever one is missing or orphaned. The existing `claimPage` makes the newest copy own the frame.
  - Each result carries a `frameId`, so no `webNavigation` permission is needed.
  - Since Chrome 133, `executeScript` also falls back to the frame's origin by default.
- **Then** every frame runs the deeper scan (R2 rules, all shadow roots) and reports. A press that found nothing re-runs automatically after this (FR-002).

## R4. Fallback reader: "deep reader" (Story 4, P3)

**Decision:** Use `chrome.debugger` with `DOMSnapshot.captureSnapshot`, **not** the accessibility tree.
- The accessibility tree marks `aria-hidden` and `inert` subtrees as `ignored` (`ariaHiddenSubtree`), so it would repeat this exact bug.
- `DOMSnapshot` returns every document including frames, every shadow root including closed ones, input values, `isClickable` and layout bounds.
- **Cost:** a permission warning ("Access the page debugger backend") and Chrome's "started debugging this browser" bar.

So:
- `debugger` goes in `optional_permissions`, requested only when the user presses **Try the deep reader**, after the panel explains the bar.
- It attaches, captures, maps fields to frames and boxes, fills through the normal content script by position, and detaches straight away.
- It is built last, and only if Stories 1–3 leave real gaps.

**AI:** not in this feature (the user wants the no-AI autofill solid first). An AI pass to label a list of fields is a later option. A screenshot pass is out because of privacy and cost.

## R5. "Copy what Job Catcher saw": the scan report

**Decision:** Every frame can return a **scan report**:
- the frame's host;
- how many controls it found, kept and dropped, with the drop reasons;
- for each kept field: label (80 characters), kind, hints (autocomplete, name and id, 40 characters each), visible facts, the decision (profile key / learned / AI / need-you reason), and whether it's in the pop-up.

It never includes values. The panel joins the frames, adds the extension version and the page host, and copies plain text on the user's press. A unit test checks that no profile value can ever appear in it.

**Rationale:** This replaces "send me the HTML". It's what turns a failure into a lab page without asking the user again.

## R6. Point at a box: picker and teaching

**Decision** (uBlock epicker technique, adapted):
- **Start:** the panel's **Point at a box** sends `startPick` to every frame.
- **Highlight:** each frame shows a `pointer-events: none` outline in a closed shadow host at the maximum z-index. It's shown with `showPopover()` when a native modal `<dialog>` is open (the top layer), or appended inside that open dialog.
- **Hovering:** capture-phase `pointermove` on `window`, then `composedPath()[0]` (this reaches open and closed shadow roots), then the nearest field. That's an input, select, textarea, contenteditable, `[role=combobox|textbox|radiogroup|radio|checkbox|listbox]` or a MUI root; a click on a form or section picks the whole form.
- **Clicking:** capture-phase `pointerdown`, `mousedown` and `click` all get `preventDefault` and `stopImmediatePropagation`, so the page never receives the click. Esc is caught the same way, so MUI doesn't close its dialog.
- **Result:** the frame that got the click reports `{frameId, field: {label, kind, options}, fingerprint}`, and the background tells the other frames to stop.
- **Panel:** shows the field's label and "What goes here?". The choices are the profile answers (searchable), a remembered answer, or "Something else (type it)". It fills immediately, saves, and stays in pointing mode for the next box until **Done**.

**Refuses:** consent, self-ID, password and payment fields (the existing guards).

**Alternatives:**
- A right-click menu ("Fill with Job Catcher → First name"). Easy to build and works everywhere, but hard to discover, and only works on editable fields. Kept as a later shortcut.
- DevTools-style inspect through `chrome.debugger`. The warning bar makes it a no.

**Market:** none of Simplify, Jobright, LazyApply or Teal has point-and-teach. Their fallback is "request support". A 1Password community thread from Oct 2026 asks for exactly this, so it would set Job Catcher apart.

## R7. Remembering a taught box: a fingerprint, not a CSS path

**Decision:** store a fingerprint:
- **text:** label (normalized), `name`, `id` (only if hand-written: @medv/finder's "word-like" test rejects `css-1x2y3z`, `jss123`, `:r3:` and long digit runs), `autocomplete`, `aria-label`, `placeholder`, `data-testid`, `type`/tag/`role`;
- **context:** the nearest heading or legend, and the field's index among the form's fields.

Key it by the registrable site (`paycomonline.net`, plus the company path on shared hosts, as with `siteOf`).

**Matching** (Similo-style weighted score):
- exact stable `name`/`id`/`data-testid`: 1.0
- the same normalized label: 0.9
- `autocomplete`/`aria-label`/`placeholder`: 0.7
- `type`, `section` and `index`: small boosts

Accept the best match only if it scores ≥ 0.75 and beats the runner-up by ≥ 0.15. Otherwise skip it and list it for review, because a loose threshold fills the wrong box. One taught entry fills at most one box per page.

**Priority:** taught entry, then profile rules, then remembered answers, then AI.

## R8. Where taught boxes live

**Decision:** a new backend table `taught_fields`:
- `user_id`, `site`, `fingerprint` (JSONB), `profile_key` or `answer`, `use_count`, `last_used_at`, timestamps;
- row-level security per user;
- at most 500 per user, and at most 50 per site.

It's served inside the existing autofill bundle (spec 015), so it works on every computer and is cached on the device. New taught entries are saved through `POST /v1/autofill/taught`, and Settings lists and deletes them.

**Alternative rejected:** device-only storage. It would be lost between the user's two computers, which has already bitten them this week.

## Sources

- **MUI v4 modal behaviour:**
  - ModalManager: https://raw.githubusercontent.com/mui/material-ui/v4.12.4/packages/material-ui/src/Modal/ModalManager.js
  - Portal: https://raw.githubusercontent.com/mui/material-ui/v4.12.4/packages/material-ui/src/Portal/Portal.js
  - Modal: https://raw.githubusercontent.com/mui/material-ui/v4.12.4/packages/material-ui/src/Modal/Modal.js
  - The same pattern elsewhere: https://bugzilla.redhat.com/show_bug.cgi?id=1926289
  - `aria-hidden` npm package: https://github.com/theKashey/aria-hidden
- **Visibility:**
  - Chromium autofill visibility: https://chromium.googlesource.com/chromium/src/+/HEAD/components/autofill/content/renderer/form_autofill_util.cc
  - `checkVisibility`: https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility
- **Reaching frames:**
  - content scripts manifest: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
  - scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
  - origin fallback by default: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/D8DcJARVM90/m/mj4U-XOCAAAJ
- **Deep reader:**
  - debugger API: https://developer.chrome.com/docs/extensions/reference/api/debugger
  - DOMSnapshot: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/DOMSnapshot.pdl
  - Accessibility: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Accessibility.pdl
- **Pickers and remembering a box:**
  - uBlock Origin epicker: https://github.com/gorhill/uBlock/blob/master/src/js/scriptlets/epicker.js
  - @medv/finder: https://github.com/antonmedv/finder/blob/master/finder.ts
  - Similo: https://arxiv.org/abs/2208.00677
  - `chrome.dom`: https://developer.chrome.com/docs/extensions/reference/api/dom
  - contextMenus: https://developer.chrome.com/docs/extensions/reference/api/contextMenus
- **Top layer and modals:**
  - https://benfrain.com/?p=4732
  - https://web.dev/articles/baseline-in-action-dialog-popover
- **Teach tools:**
  - Bitwarden custom fields: https://bitwarden.com/help/auto-fill-custom-fields/
  - Bitwarden Fill Assist: https://bitwarden.com/help/fill-assist/
  - Lightning Autofill: https://docs.lightningautofill.com/help/form-fields
  - Simplify, autofill not supported: https://help.simplify.jobs/articles/8717287-autofill-not-supported
  - 1Password request: https://www.1password.community/1password-at-work-58/taking-autofill-to-the-next-level-user-guided-field-mapping-transparency-25733
