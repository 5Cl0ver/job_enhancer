# Research: Autofill you can always find, that always works

Three research passes (2026-11-23):

1. **Browser and password-manager autofill:** Chromium source, Firefox docs, Bitwarden docs.
2. **The forms of 9 applicant systems:** the open-source atsfill adapter surveys, plus Paycom's own JavaScript bundles.
3. **Job-autofill extensions:** the Simplify Copilot 3.1.16 and Jobright 1.27.0 packages were read directly, plus the open-source Autofill-Jobs, job_app_filler and Formhand.

Sources are listed at the end.

## R1. Why the user couldn't find Autofill on Paycom

**Decision:** Treat this as four separate failures and fix each one.

1. **The panel gated on the web address.** Paycom's address has no "apply". *Fix:* the panel follows per-frame **form presence**, not the address (R2).
2. **The page button may sit outside a modal.**
   - Paycom's Quick Apply is a React (MUI v4) pop-up with `role=dialog` / `aria-modal`.
   - A native `showModal()` dialog draws above every z-index and makes the rest of the page **inert**, so a button outside it can't be clicked (MDN, Ben Frain).
   - 1Password has the same bug with Material dialogs.
   - *Fix:* while a pop-up holding the form is open, the button lives *inside* it (R4).
3. **The shortcut clash.** Simplify Copilot ships `Alt+Shift+F` as its own "trigger-autofill" command. Chrome gives a suggested key only to the first extension that claims it; the other gets **no shortcut, silently**. *Fix:* R5.
4. **Missing labels.** Some forms put the label after the box, and the reader didn't look there. *Fix:* R3.

**Rationale:** Each was confirmed in source, docs or the vendors' own packages, and any one of them alone explains "I can't find it".

## R2. When does a page "have a form"?

**Decision:** A frame has a form when:
- its visible fillable fields number **3 or more**; or
- it passes the existing application check; or
- the site sets `autocomplete` tokens on 2 or more fields; or
- the address is on the applicant-system list (R6) and it has 2 or more fields.

A visible password box means "no" (a sign-in page), unless the frame has 6 or more other fields (sign-up-and-apply pages such as iCIMS and UKG).

**When it re-checks:**
- on DOM changes, debounced to 300 ms (the existing control signature);
- on address changes: `pushState`, `popstate` and `hashchange`.

**Rationale:** Chromium's `kMinRequiredFieldsForHeuristics = 3` is the industry baseline. Simplify and Jobright also scan every page and every frame.

**Alternatives rejected:**
- An ML classifier: Chrome's needs crowdsourced training data. Firefox uses its Fathom model only for credit cards.
- Address-only detection: this is the bug itself.

## R3. Reading the question for a box (label order)

**Decision:** Follow Chromium's `InferLabelForElement`, adapted:
1. `label[for=id]`, searched in the box's own root
2. the wrapping `<label>`
3. `aria-labelledby`
4. `aria-label`
5. a **floating label after the box**: a following sibling `<label>`/`<span>` drawn over the box. The box must come first in its wrapper, so a flat "label, input, label, input" list never takes the next field's label.
6. text before the box (existing `nearbyText`)
7. a table cell (`<td>`/`<th>` header for the column or row), or `<dd>`/`<li>`
8. the placeholder

`aria-describedby` is used only as a weak hint, never as the question. Labels made only of symbols (`*:-()`) are rejected.

**Rationale:** This matches what Chrome ships. The surveys show:
- `label[for]` on Paylocity, iCIMS, JazzHR and Paycom (MUI `InputLabel htmlFor`);
- `data-testid` / `id` on Rippling and Dayforce, already a hint;
- placeholder-only city/state/zip on JazzHR.

## R4. A page button that can't be buried: superseded by a user decision

**Final decision (user, 2026-11-23):** no Autofill button on the page at all. Everything is in the side panel and the toolbar icon, and the pill is removed.
- Chrome's side panel can never be covered or made inert by a page.
- The analysis below is kept for a later "nice on-page effects" feature.

**Earlier proposal (not built):**
1. **Only the top frame draws the button.** A press is relayed by the background to every frame with a form (Simplify and Jobright do the same).
2. **Inside an open pop-up:** if an open pop-up holds fields, the button host is moved into it, at its bottom-right corner. Open pop-ups are found with Jobright's selector list: `dialog[open]`, `[aria-modal=true]`, `[role=dialog]`, `mat-dialog-container`, `sdf-dialog`, `sdf-modal`, `sdf-focus-pane[data-sdf-modal]`. When the pop-up closes, the host moves back.
3. **Otherwise:** the host goes in the top layer with `popover="manual"` + `showPopover()`, above every z-index. Older Chrome falls back to fixed position and the maximum z-index.
4. **Dodge covers:** after placing it, `elementFromPoint` at its centre must hit our own host. If not (a cookie banner, a chat bubble), try the other corners and edge midpoints, then stay at the first clear spot. Re-check every 2 s while shown, and on resize.
5. **Re-attach** if the page's framework removes the host (MutationObserver on `documentElement` child list).

**Alternatives rejected:**
- Simplify/Jobright's docked 384 px panel that narrows the page. We already have Chrome's side panel, which can never be covered, and the panel is the primary home.

## R5. The keyboard shortcut

**Decision:**
- Change the suggested key to **Alt+Shift+J** ("Job"), which isn't used by Simplify, Jobright or Chrome.
- The panel reads `chrome.commands.getAll()` and shows the **real** key under the Autofill button. If none is assigned, it shows "Set a shortcut" (opens `chrome://extensions/shortcuts`).
- The shortcut works with the panel closed. The badge flashes the result so the user still knows it happened.

**Rationale:** A clash is silent. Showing the real key turns it into one obvious fix.

## R6. One applicant-system list

**Decision:** `extension/src/autofill/hosts.js` exports `APPLICANT_HOSTS` (host + optional path), used by both the page check and the panel's `detectContext`. It covers:
- **Existing:** Workday (`myworkdayjobs`, `myworkdaysite`), Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, Jobvite, Workable, Taleo, SuccessFactors, Indeed apply.
- **Added from the research:**
  - Paycom: `paycomonline.net`/`.com`, path `/v4/ats/`
  - Paylocity: `recruiting.paylocity.com`, `/Recruiting/`
  - UKG/UltiPro: `recruiting*.ultipro.com`/`.ca`, `*.rec.pro.ukg.net`
  - ADP: `workforcenow.adp.com` `/mascsr/`, `myjobs.adp.com`, `recruiting.adp.com`
  - Dayforce: `jobs.dayforcehcm.com`, `/CandidatePortal/`
  - BambooHR: `*.bamboohr.com/careers`
  - JazzHR: `*.applytojob.com`
  - Breezy: `*.breezy.hr`
  - Recruitee: `*.recruitee.com`
  - Rippling: `ats.rippling.com`, `*.rippling-ats.com`
  - Oracle: `*.oraclecloud.com` `/hcmUI/CandidateExperience`
  - Avature: `*.avature.net`
  - Eightfold: `*.eightfold.ai`
  - BrassRing: `*.brassring.com`
  - Pinpoint: `*.pinpointhq.com`
  - TriNet Hire: `app.trinethire.com`

## R7. Fill order: résumé first, then settle

**Decision:**
1. If the form has a résumé upload, upload it **first**.
2. Wait for the form to settle: no DOM changes for 600 ms, capped at 6 s.
3. Then rescan and fill everything else.

On an automatic step (keep filling), the same applies only when the upload box is empty.

**Rationale:** Paylocity, Dayforce, Rippling and iCIMS read the résumé and re-render or overwrite the form, and Paycom has an "autofill with résumé" uploader. Filling first gets wiped.

## R8. Phone beside a country-code picker

**Decision:** When a phone box has a dial-code picker or a "+1"-style prefix in the same field group:
- fill the **national number** only (digits, without the country code);
- set the picker from `phone_country` (existing) if it's empty.

A box whose own value already starts with "+1" (react-phone-number-input on ADP) gets the national digits typed after it.

**Rationale:** Paycom (libphonenumber), Dayforce, Rippling, ADP and the iCIMS sign-in all split the number this way. A doubled "+1 +1…" fails validation.

## R9. Pop-ups: fill only what's in front

**Decision:** When an open pop-up holds fields, a run fills **only inside that pop-up**. Fields behind it are invisible to the user and may belong to another form.

**Rationale:** Jobright does exactly this, and it matches what the user sees.

## R10. Feedback after every press

**Decision:**
- The toolbar badge flashes the filled count (green), or "!" (amber) on failure, for 4 s, then returns to ⚡ while the page has a form.
- The panel shows one plain line for every outcome. When nothing matched: "Nothing here matched your profile: the fields are listed for you", with the fields listed.

## Sources

- **Chromium label inference:** https://chromium.googlesource.com/chromium/src/+/HEAD/components/autofill/content/renderer/form_autofill_util.cc
- **Chromium 3-field minimum:** https://chromium.googlesource.com/chromium/src/+/HEAD/components/autofill/core/common/autofill_constants.h
- **Firefox heuristics:** https://firefox-source-docs.mozilla.org/browser/extensions/formautofill/docs/heuristics.html
- **Bitwarden autofill:**
  - https://contributing.bitwarden.com/architecture/deep-dives/autofill/autofill-menu
  - https://contributing.bitwarden.com/architecture/deep-dives/autofill/shadow-dom
- **Modal inertness and the top layer:**
  - https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
  - https://web.dev/articles/baseline-in-action-dialog-popover
  - https://benfrain.com/?p=4732
- **1Password behind a Material dialog:** https://www.1password.community/1password-at-home-31/1password-browser-extension-not-working-when-a-text-field-is-inside-a-dialog-material-web-22546
- **ATS surveys:** https://github.com/shbernal/atsfill/tree/main/docs/adapters
- **Simplify:**
  - https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications
  - https://simplifyjobs.featurebase.app/p/simplify-keeps-popping-up-on-some-websites
  - Chrome Web Store package 3.1.16, read directly
- **Jobright:** Chrome Web Store package 1.27.0, read directly; https://jobright.ai/blog/supercharge-your-job-search-with-jobright-autofill/
- **Open source:**
  - https://github.com/berellevy/job_app_filler
  - https://github.com/andrewmillercode/Autofill-Jobs
  - https://github.com/fdjfnd222dd/formhand
- **React value setting:** https://github.com/facebook/react/issues/10135
