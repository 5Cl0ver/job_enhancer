# Research: Job Catcher overhaul (015)

Each entry gives the decision, why it was chosen, and the alternatives considered. Evidence comes from reading the extension and from a probe run on 2026-11-23. The probe loaded the built 0.27.0 extension in Chromium against an invented form and a fake server.

## Probe results (baseline)

| Field on the invented form | Result today |
|---|---|
| First, last, email, phone (plain labels) | ✅ filled |
| Confirm email | ❌ empty: only one field per key is ever filled |
| LinkedIn (labelled by `aria-labelledby`) | ❌ empty: label lookup ignores `aria-labelledby` |
| Search-style dropdown "authorized to work" | ❌ typed "Yes" into the search box, no option picked, **counted as filled** |
| Native select "sponsorship" | ✅ |
| Radio "relocate" | ✅ |
| City inside a shadow-DOM component | ❌ not found |
| Résumé file | ✅ |
| Essay and gender | ✅ left alone |
| Time per press | 0.3 s with an instant server; **16 s** with a 4 s server delay (4 serial calls). On a sleeping Render server: error, "Open panel & sign in". |

## R1 — Where the answers come from on a press: a copy held by the extension

**Decision**: The background worker keeps an **autofill copy** in `chrome.storage.local`:
- profile and email
- remembered answers
- work history and education
- résumé metadata and résumé bytes (or the staged tailored résumé)
- a version stamp

`GET /v1/autofill/bundle?version=` answers `{changed:false}` without reading much, or the full bundle. Résumé bytes are fetched again only when the résumé id or `parsed_history_at` changes.

The copy refreshes:
- on sign-in
- when the panel opens
- on a press, in the background and never blocking it
- at most every 60 s while autofill is being used

It is wiped on sign-out or when a different email signs in.

**Rationale**: A press can't depend on a free server that sleeps. This is the same version-check pattern already used for the saved-jobs list (`/saved-jobs/summary?version=`).

**Alternatives**:
- Parallelising the 4 calls: still blocked by cold starts.
- An in-memory cache only: a service worker is killed after about 30 s idle, so the copy would be lost.

## R2 — Reading the résumé once

**Decision**: Add `resumes.parsed_history` (JSON `{work:[…], education:[…]}`) and `parsed_history_at`.
- A new `ai_service.parse_resume_history` returns work and education together.
- It runs after a résumé upload (FastAPI `BackgroundTasks`), and lazily when the bundle finds it missing. The bundle then answers with `history: null, history_pending: true`, and the next change check picks it up, because the version includes `parsed_history_at`.
- `POST /v1/ai/work-history` serves from this cache, for compatibility.

**Rationale**: Today Workday re-asks the AI on every press (10–20 s). Reading once also gives education, which Workday asks for and isn't supported today.

**Alternatives**:
- Parsing in the extension: no AI there.
- New profile columns per job: too heavy, and the résumé is the truth.

## R3 — Finding fields: a deep walk

**Decision**: `scan/walk.js` walks `document`. For every element with a shadow root it descends into `el.shadowRoot`, or into `chrome.dom.openOrClosedShadowRoot(el)` when running in a content script; that API reaches closed roots. It also walks same-origin `iframe.contentDocument`. The shadow-root getter is injected as a parameter, so Vitest can pass a stub.

Other-origin frames run their own copy of the content script: the manifest has `all_frames: true` and `match_origin_as_fallback: true`, so about:blank and srcdoc frames are covered. One press reaches them through the background, which sends to every frame of the tab.

**Rationale**: `document.querySelectorAll` never enters shadow roots or frames. That is the probe's "city" miss, and why whole sites built from web components fail.

**Alternatives**: A per-site hard-coded frame and shadow handling: rejected, because every site is different.

## R4 — The question for a control

**Decision**: Labels are resolved in this order. The first non-empty one wins; the parts are cleaned and stripped of "*" and "(required)":
1. `label[for=id]`, searched in the control's own root, not just the document
2. a wrapping `<label>`
3. `aria-labelledby`, joining several ids
4. `aria-label`
5. `fieldset > legend`, for group members
6. the closest preceding text block within the control's field container, walking up at most 3 levels and stopping at another control
7. `placeholder`
8. a humanised `name` or `id`, used only for profile mapping and never for remembering

`autocomplete` stays the strongest signal for **profile keys**, separate from the question text.

**Rationale**: The probe's LinkedIn (aria-labelledby) and "Preferred first name" (a sibling div) misses. Modern boards label with divs.

## R5 — One writer per kind, verified by reading back

**Decision**: `widgets/index.js` exposes `write(field, value) → Promise<{ok, actual}>`, `read(field)`, `snapshot(field)` and `restore(field, snap)` for each kind:

- **text / textarea**: native setter, then `focus`, `beforeinput`, `input`, `change`, `blur`, `focusout`. This keeps today's React fix.
- **contenteditable**: `focus` + `document.execCommand("insertText")`. If that's unavailable, set textContent and send an `input` event.
- **select**: option match by **R7**, then `change` and `blur`.
- **combobox**: this covers `role=combobox`, `aria-haspopup=listbox` buttons (Workday) and react-select-style inputs. It runs these steps:
  1. open it with the pointer sequence `pointerdown → mousedown → pointerup → mouseup → click`, or focus plus ArrowDown;
  2. if it's typeahead or has more than 50 options, type the value;
  3. wait up to 3 s for `[role=option]` items owned by `aria-controls`/`aria-owns`, falling back to visible options anywhere;
  4. pick by R7 using the same pointer sequence;
  5. close it, and read back from the displayed value, `aria-activedescendant` or a hidden input.

  If nothing matches, it clears what it typed and reports `no_option`.
- **choice**:
  - radio groups: by name; also `role=radiogroup` and `role=radio`
  - button groups: Yes/No `<button>`s with `aria-pressed` or one selected class inside one question container
  - checkbox lists: several checkboxes under one legend; only remembered answers fill these, and consent boxes are never filled
- **date**:
  - `type=date`: ISO value
  - split month/year: Workday's date sections, keeping today's tested re-query and clear-half-dates logic
  - typed `MM/DD/YYYY`: the format is inferred from the placeholder or pattern
- **file**: `DataTransfer` into the input. If the input is hidden behind a drop zone, a `drop` event with the same DataTransfer goes on the zone. The résumé never goes to a field whose question says cover letter, transcript or portfolio.

Only `ok && read(field) ≈ value` counts as **filled**. Anything else is reported "Need you" with a reason.

**Rationale**: This removes the "counted as filled but empty" class of bug for good, and makes one tested place per widget instead of five passes.

**Alternatives**: Keeping per-site passes: that is today's design, and it doesn't scale to "every page is different".

## R6 — Deciding a value: tiers and guards

**Decision**: `resolve(field, copy)` works in this order:

1. **Guards first.** These return a Skip reason and nothing else:
   - `SELF_ID` (extended: pronouns, sexual orientation, and the voluntary disclosure section): Skip
   - `CONSENT`: terms, privacy, attest, certify, acknowledge, "I agree"
   - `ESSAY`: cover letter, "why …", "tell us about", or a textarea with `maxlength` over 500
   - `NOISE`: newsletter, cookies, marketing
   - passwords and CAPTCHAs
   - a non-empty field the user filled, which is never overwritten
2. **Profile keys.** The existing RULES, extended with:
   - preferred name, middle name
   - confirm email, which gives the email
   - phone device type, which gives "Mobile"
   - phone country code
   - current company and current title, from work history item 0
   - school, degree, field of study and graduation year, from education item 0
   - "how did you hear": not in the profile, so it goes to remembered answers
3. **Remembered answers.** `matchAnswer`, with today's pivot guard on countries, numbers and negation, then `matchOption` for choice fields.
4. **Rules.** Today's date for signature dates.
5. **AI.** The leftovers, batched (R9).

Every Decision carries `source` (profile, learned, rule or ai) and `confidence`.

## R7 — Matching an answer to the page's options

**Decision**: `matchOption(answer, options)` checks in this order:
1. exact, ignoring case and spaces
2. same value attribute
3. yes/no equivalents: "Yes", "Yes, I am authorized…", "I am", "True", "Y" / "No…", "I am not", "False"
4. option starts with the answer, or the answer starts with the option, when the option is at least 4 characters
5. token overlap (Jaccard) of at least 0.6, with the same pivot guard

For locations it also tries "City, ST", "City, State" and "City".

## R8 — Review home: side panel "Apply" view + on-page pill

**Decision**: The page shows only a **pill**: a shadow-root host fixed at the bottom-right that collapses to an icon after a few seconds idle. It reads "⚡ Autofill" → "Filling…" → "✓ 14 filled · 2 need you · Review · Undo". Outlines are styled per shadow root, through a `<style>` adopted into each root the scan entered.

**Review** sends `openReview`, and the background calls `chrome.sidePanel.open({tabId})`. That's allowed from a content-script click, per the Chrome sidePanel docs (Chrome 116+ allows it after a user gesture in a content script).

The panel's Apply view shows the merged sessions of every frame in the active tab:
- **Need you**: orange, each with Show
- **Check these**: AI answers, plus suggestions with Use
- **Filled**: profile and remembered, collapsed to "12 filled from your profile ▾"
- **New answers to remember**
- **Undo all**
- the "Keep filling this application" switch

Fix shows the field's real options for choice fields and a text box otherwise.

**Rationale**: Only the panel can see every frame at once; the page frames can't see each other. It never covers the form and survives step changes. The user asked for short, uncluttered screens, which the collapsed "Filled" group and the one-line pill answer.

**Alternatives**: Today's on-page drawer, which covers the form, gets restyled by the site and can't see frames. Inline badges next to every field, which are fragile on shifting layouts.

## R9 — AI tier

**Decision**: After the instant tier, the remaining non-guarded fields of the **current step** go out as one `aiMapFields` call, cached by step fingerprint so a re-press doesn't ask again.
- The request carries only `{id, label, type, options}`.
- `POST /v1/ai/autofill-map` adds `confidence: {id: 0..1}` to its answer. The prompt asks for a value and a confidence per field.
- Old clients ignore the new key.
- Confidence of 0.75 or more fills purple ("check"); anything lower becomes a suggestion only.
- Today's per-dropdown Workday AI path is replaced by this one batch.

**Note**: The memory file `ai-quick-apply.md` records an invalid NVIDIA key (403) in the past. The live AI is checked during PR C. Story 5 is designed to add nothing if it's down.

## R10 — Multi-step and learning

**Decision**:
- `session.js` watches the frame with a MutationObserver, debounced by 400 ms. A **step fingerprint** is the sorted set of question keys for visible fields. When the fingerprint changes, keep-filling is on, and the tab is on the same registrable domain as the press, it runs the instant tier on new, empty fields, then the AI tier once for that fingerprint.
- Keep-filling is held per tab in `storage.session` and ends when the tab navigates to another site.
- **Noticing answers**: the session records which learnable fields were empty or "need you" at fill time. On a capture-phase click of a button whose text matches `next|continue|save( & continue)?|review|submit|apply|send`, or on `pagehide`, it diffs them. A field the user now filled becomes a pending answer `{question_key, question_text, answer, options?}` held in `storage.session` by the background, and the panel lists it. Nothing is saved until the user presses Save (`PUT /v1/users/me/custom-answers`, existing).
- Fix on a remembered or AI row saves at once. That's an explicit user action, as today.

## R11 — Test lab (invented pages, structures only)

Pages are served by the test's HTTP server on two origins, `localhost` and `127.0.0.1`, to get a real other-site frame. Each page records its own form data in `window.__formData()`, or by posting to `/__submit` on a submit that the test makes, never the extension.

| Page | Shape it copies (structure only, invented brand "Vellacor Robotics" etc.) |
|---|---|
| `classic.html` | plain labelled form, Lever-style; confirm email; résumé + cover-letter file inputs |
| `react-form/` | **a real React 19 app** (built by esbuild): controlled inputs, a react-select-style search dropdown, a location typeahead fed by a fake look-up, a yes/no button group, a date field. Data read from React state. |
| `workday/` | a 4-step single-page app with `data-automation-id` structure: My Information, then My Experience (Add Another, month/year date sections, Education), then Application Questions (listbox buttons), then Voluntary Disclosures (self-ID) and Review |
| `buttons-typeahead.html` | Ashby-style Yes/No buttons + location typeahead |
| `embed-host.html` | a careers page on `127.0.0.1` embedding the classic form from `localhost` in an iframe |
| `shadow.html` | the whole form built from web components (open + closed roots) |
| `easy-apply.html` | a pop-up dialog with Next/Review steps on a job page |
| `noise.html` | sign-in, search and newsletter forms: no pill must appear |
| `prefilled.html` | values already typed: must be unchanged |
| `sensitive.html` | EEO self-ID + consent/attest boxes + essay: untouched |

The fake app server (`e2e/support/fake-api.js`) serves:
- auth: a token is seeded into storage, so no sign-in is needed
- the bundle and version
- the résumé bytes
- remembered answers (GET and PUT)
- autofill-map, with scripted answers, confidence, delay or failure
- mark-applied, recorded
- the saved-jobs summary
- Scout active-run and captures, for regression

`e2e/support/launch.js`:
1. copies `extension/` (without node_modules) to a temp dir;
2. writes a test `config.js` pointing at the fake server;
3. adds `http://localhost/*` and `http://127.0.0.1/*` to the autofill and Scout script matches.

All of this happens in the copy only. The repo's `config.js` and `manifest.json` are never touched, so live stays live.

## R12 — Updates without reload

**Decision**: `background/reinject.js` runs on `runtime.onInstalled` (install and update). It queries tabs matching each content-script entry's patterns and calls `chrome.scripting.executeScript({target:{tabId, allFrames}, files})` for the matching scripts. MAIN-world scripts (the Indeed bridge) get `world:"MAIN"`.

Every content script starts with an **orphan guard**:
- a per-version global marker (`window.__jeLoaded === VERSION` means stop);
- removal of any `#je-*` elements and shadow hosts left by an older copy;
- its existing `safeSend` orphan check.

**Rationale**: The update trap is the cause of Scout's "didn't copy 9 pages".

## R13 — Scout "Save anyway"

**Decision**: `SaveFindingIn` gains `anyway: bool = False`. When there's no capture and `anyway` is set, `save_one` saves a job from the finding's own fields:
- title, company, location and the link
- an empty description
- origin Scout

The listing then counts as `needs_details`.

The existing passive backfill fills the full posting the next time the user opens the page. On the job boards that's `content.entry.js` → `backfillJob`; for other sites the Scout page copier is extended to backfill a saved, thin job too.

Results shows **Save anyway** next to "Open and press Save" when `!can_save`.

## R14 — CI

**Decision**: A new `extension` job in `.github/workflows/ci.yml` runs on ubuntu-latest:
1. `npm ci`, then `npm run build`, then `npx vitest run`
2. `npx playwright install --with-deps chromium`
3. `xvfb-run -a npx playwright test`

MV3 extensions need headed Chromium, which is why xvfb is used. Failing extension tests block merging, like the backend and frontend jobs.
