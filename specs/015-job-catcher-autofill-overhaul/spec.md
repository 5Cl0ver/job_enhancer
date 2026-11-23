# Feature Specification: Job Catcher overhaul — instant, reviewable autofill on any application page

**Feature Branch**: `015-job-catcher-autofill-overhaul`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Extension not working! We need to really overhaul it: same features, everything, but make it 20 times better. I really want it to help me autofill things on pages super fast, but I still get to review everything. Every application page will be different for the most part, and our extension is not dynamic and built weirdly. Really test it, on fake data only, until I try it." Follow-up: "Why can't I just save [a Scout result] to the app?"

## What's wrong today (found by reading the code and running it against an invented form)

The current autofill was run in real Chrome against an invented application form, with a fake app server behind it.

- **It reports success on fields it didn't fill.** On a search-style dropdown ("Are you legally authorized to work in the United States?") it typed "Yes" into the search box but never picked the option. The form would send it empty, and the summary still counted it as filled.
- **It misses common fields:**
  - "Confirm email": it fills only the first field of each kind.
  - Fields labelled the modern way, by a separate text element.
  - Fields inside page components that hide their insides (shadow DOM). Some application sites build their whole form this way.
  - Forms inside an embedded frame, as used by company careers pages that embed an applicant system.
- **It is slow and breaks when the server is asleep.**
  - Every press makes four server calls one after another: about 16 seconds when the server is slightly slow.
  - When the free server is asleep, the calls fail and the button says "Open panel & sign in", which is the wrong reason.
  - On Workday, every press also asks the AI to re-read the whole résumé.
- **One press covers one step.** Multi-step applications (Workday, Easy-Apply-style pop-ups) need a press on every step.
- **The review list sits on top of the form.** It is a box drawn into the page, so it covers fields, takes on the site's styling, and disappears when the page changes step.
- **The button appears on any page with two fields**, including sign-in and newsletter forms.
- **It learns only when asked.** Answers are remembered only if you press "Remember my answers" before leaving the page.
- **Updates need a manual reload.** After an update, every open tab keeps the old copy until the extension is reloaded in `chrome://extensions` and each tab is refreshed. This is why Claude Scout's last run copied none of its 9 jobs.
- **No end-to-end tests.** None of the 129 extension tests runs autofill in a real browser, and the project's checks (CI) don't run the extension's tests at all.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One press fills the page, right, instantly (Priority: P1)

I open an application form on any site and press **Autofill** (on the page, in the side panel, or with a keyboard shortcut). Within a moment every field the app knows the answer to is filled:
- name and preferred name
- email and confirm email
- phone and address
- links
- work authorization, sponsorship and relocation
- salary and start date
- my résumé file
- answers I gave before

Every kind of control is filled the way a person would fill it:
- typed boxes
- dropdowns, including search-style ones
- yes/no buttons and radio choices
- check-box lists
- dates
- file uploads

This works the same inside embedded forms and hidden-inside components. Nothing is ever submitted, and nothing I typed is overwritten.

**Why this priority**: This is the reason the extension exists, and today it's slow and silently wrong on modern forms.

**Independent Test**: In the test lab (invented application pages built in the shapes real applicant systems use), with a fake app server, press Autofill. Then check what each page's own form code holds, not just what's painted on screen.

**Acceptance Scenarios**:

1. **Given** I'm signed in and the app has my details, **When** I press Autofill on a form, **Then** every field I have an answer for is filled within 1 second, with no wait on the server.
2. **Given** a search-style dropdown asking a yes/no question I've answered in my profile, **When** autofill runs, **Then** the matching option is actually selected. The form's own data holds it, and the field is only counted as filled once that's confirmed.
3. **Given** a form with "Email" and "Confirm email", **When** autofill runs, **Then** both hold my email.
4. **Given** a form embedded from another site in a frame, or built from components that hide their insides, **When** I press Autofill once, **Then** those fields are filled too.
5. **Given** a field I already typed in, **When** autofill runs, **Then** my text is untouched.
6. **Given** questions about race, ethnicity, gender, veteran or disability status, or a terms/consent box, **When** autofill runs, **Then** they're never filled, guessed or remembered.
7. **Given** the app's server is asleep, **When** I press Autofill, **Then** it still fills instantly from the copy of my details the extension already holds. On the very first use on a computer it says "Waking up the app…" and fills when the server answers. It never says to sign in unless I'm actually signed out.
8. **Given** a sign-in page, search box or newsletter form, **When** it loads, **Then** no Autofill button appears.

---

### User Story 2 - I review everything, in one clear place (Priority: P1)

After a fill, a short line on the page says what happened, for example "✓ 14 filled · 2 need you · Review". Each filled field is outlined in the color of where its answer came from:
- green: my profile
- blue: remembered
- purple: AI, check it
- orange: needs me

**Review** opens the side panel, which lists every field it touched:
- a chip saying where the answer came from
- the value
- **Fix** (change it with the page's real options; the page updates at once)
- **Show** (scrolls to the field and flashes it)
- **Undo**

It also lists the questions only I can answer, each with Show, and has **Undo all**. The list stays current when the page changes step and never covers the form.

**Why this priority**: The user wants speed *and* to review everything. Review that covers the form or disappears between steps isn't review.

**Independent Test**: In the lab, autofill a form, open Review, Fix one value and Undo another, then Undo all. Check the page's own data after each action.

**Acceptance Scenarios**:

1. **Given** a filled page, **When** I press Review, **Then** the side panel opens and lists every field autofill touched, with its source and value, and every question left for me.
2. **Given** a field filled with the wrong option, **When** I Fix it in the panel, **Then** the page's control changes, the page's own data changes, and the row shows the new value.
3. **Given** a fill I don't want, **When** I press Undo on its row (or Undo all), **Then** the field goes back to exactly what it held before autofill.
4. **Given** the application moves to its next step, **When** the panel is open, **Then** the list shows the new step's fields.

---

### User Story 3 - It learns my answers without extra steps (Priority: P2)

When I answer a question the app didn't know and move on, the extension notices and offers it in the panel under **New answers to remember**. "Move on" means pressing Next, Continue, Save or Submit, or leaving the page.

Each offered answer can be kept or unchecked and edited, then saved with one press. Nothing is saved without that press. Next time any site asks the same question, it's filled (blue). A Fix on a remembered or AI answer is remembered too.

**Why this priority**: Most of an application's time goes on the long tail of custom questions. Learning them once is the biggest lasting speed-up, but it depends on Stories 1–2.

**Independent Test**: In the lab, answer an unknown question by hand and press Next. Save it from the panel. Open a different lab form that asks the same question in other words, and check it fills from memory.

**Acceptance Scenarios**:

1. **Given** I typed or picked an answer to an unknown question, **When** I press Next or Submit, **Then** the panel offers it, and nothing is stored until I press Save.
2. **Given** a remembered answer "Yes", **When** another site asks the same question as a dropdown with "Yes, I am authorized" / "No", **Then** the matching option is chosen.
3. **Given** two questions that differ by a country, a number or "not", **When** autofill runs, **Then** an answer for one is never used for the other.

---

### User Story 4 - Multi-step applications fill themselves step after step (Priority: P2)

On a multi-step application I press Autofill once. Each later step fills as it appears, until I turn it off or leave the site:
- Workday pages
- Easy-Apply-style pop-ups
- "My information → Experience → Questions"

On Workday's experience page, every job from my résumé gets its own block (titles, companies, places, dates), and so does my education. This happens at once, because the résumé was read once when uploaded, not on every press.

**Why this priority**: Multi-step sites are where applying is slowest. It builds on Story 1's engine.

**Independent Test**: Walk the lab's invented multi-step application with "keep filling" on, and check each step fills as it appears. On the experience step, check one block per résumé job.

**Acceptance Scenarios**:

1. **Given** I pressed Autofill on step 1 with "Keep filling this application" on (the default), **When** step 2 appears, **Then** it fills within 1 second without a press.
2. **Given** a Workday-shaped experience step and a résumé with 3 jobs, **When** it fills, **Then** there are 3 complete blocks with month/year dates that hold, and no half-filled dates.
3. **Given** I pressed the keyboard shortcut, **When** the tab has a form, **Then** it fills as if I'd pressed the button.

---

### User Story 5 - AI fills what's left, clearly marked (Priority: P3)

Fields nothing else could answer, and that aren't sensitive, are sent in one go to the app's AI. Only the question and its options are sent, never the page. The AI answers only from my profile, résumé and remembered answers.

Its answers arrive a few seconds after the instant fill and are outlined purple, marked "check". When the AI isn't confident, it doesn't fill: the panel shows "Suggested: … [Use]". If the AI is down, nothing breaks and the fields stay for me.

**Why this priority**: It extends reach to never-seen questions, but it's the least reliable source, so it comes after the deterministic engine.

**Independent Test**: In the lab, with the fake AI returning one confident and one unsure answer, check that the confident one fills purple and the unsure one only appears as a suggestion. Then make the fake AI fail and check the fill still completes.

**Acceptance Scenarios**:

1. **Given** unknown non-sensitive questions remain, **When** the instant fill finishes, **Then** one AI request is made for all of them, and its confident answers fill purple within seconds.
2. **Given** the AI is unreachable, **When** autofill runs, **Then** the instant fill is unchanged and the leftovers are listed under "Need you".

---

### User Story 6 - Everything else keeps working, and updates never strand me (Priority: P1)

Every current feature still works:
- the Save button on Indeed, LinkedIn and ZipRecruiter, with "Already saved"
- Save this page and Pick manually
- the saved-jobs list
- Mark applied
- Indeed applications sync
- the AI apply helper (cover letter or tailored résumé, the free AI or my own Claude, PDF, staged résumé uploaded by autofill)
- Claude Scout page copying
- tracking an application as Applied when I submit it

When the extension updates, it takes over my open tabs by itself, with no reload and no refresh. In Scout Results, a job whose page wasn't copied can still be saved: **Save anyway** keeps its title, company and link, and the full posting is added the next time I open its page.

**Why this priority**: An overhaul that breaks saving or Scout is a regression. The update trap is what made Scout copy nothing.

**Independent Test**: Run the existing extension tests plus new browser tests for:
- the Save button
- page capture
- Scout copying after an extension update with a tab already open
- tracking an application on submit
- Save anyway, then the posting text arriving when the page is opened

**Acceptance Scenarios**:

1. **Given** an open LinkedIn job tab and an extension update, **When** a Scout run starts, **Then** that tab's page is copied without me reloading anything.
2. **Given** a Scout result marked "Not copied", **When** I press Save anyway, **Then** it's in My Jobs with title, company and link. When I later open the posting with Job Catcher running, the full description is added.
3. **Given** I submit an application on a supported applicant system, **When** the page submits, **Then** the matching saved job moves to Applied, as today.

### Edge Cases

- **Signed out:**
  - the button says "Sign in to autofill"
  - pressing it opens the side panel's sign-in
  - nothing is filled from an old copy of the details after signing out, because the copy is wiped on sign-out
- **Details changed in the app** (profile, remembered answers, résumé): the extension's copy refreshes within a minute, or at once when the panel opens. A fill never uses a copy from before a sign-out or a different account.
- **Dropdown with no matching option:** left untouched, listed under "Need you" with the reason "no matching option".
- **Search dropdown loads its options from the server** (location look-ups): autofill types the value, waits up to 3 seconds for options, and picks the best match. Otherwise it clears what it typed and lists it under "Need you".
- **Field the page rejects** (it re-renders and drops the value): checked after filling, and counted as "Need you", never "filled".
- **Several résumé upload fields** (résumé + cover letter): only the résumé field gets the résumé. A field labelled "cover letter" is never given the résumé.
- **Huge pages** (hundreds of controls): scanning stays under 300 ms, and watching for new steps never slows the page.
- **Closed or unusual frames** (about:blank, sandboxed frames): handled or quietly skipped, never an error.
- **Phone:** Chrome on phones has no extensions. Everything the extension learns can be seen and edited in the app's Saved answers, which works on phone, as today.
- **AI rate limit:** at most one AI request per step. A repeat press on the same step reuses answers already given.
- **Undo on a search dropdown:**
  - with a previous choice: it re-selects that choice
  - without one: it uses the dropdown's own clear control
  - if the dropdown has no clear control: the row says "Change this one on the page" instead of pretending

## Requirements *(mandatory)*

### Functional Requirements

**Filling (Story 1)**
- **FR-001**: Autofill MUST find fields across the whole page:
  - inside components that hide their insides (open and closed shadow DOM)
  - inside embedded frames, same-site and other-site
  - the modern label forms: label element, label linked by id, aria-label, fieldset legend, and nearby text
- **FR-002**: Autofill MUST fill each kind of control by acting the way a person would, so the page's own form code registers it:
  - text boxes and text areas
  - native dropdowns
  - search-style dropdowns, typing first where the options must be looked up
  - radio groups and button-style yes/no choices
  - check-box lists
  - date inputs: native, split month/year, typed formats
  - file uploads, including drag-and-drop zones
  - editable text areas
- **FR-003**: After writing, autofill MUST read each field back. Only fields that hold the value count as filled.
- **FR-004**: Autofill MUST fill every field of a kind, for example "Email" and "Confirm email".
- **FR-005**: Autofill MUST NEVER:
  - submit or press Next, Continue or Submit
  - tick consent, terms or attestation boxes
  - touch protected self-identification questions (race, ethnicity, gender, sexual orientation, pronouns, veteran or disability status)
  - touch passwords or CAPTCHAs
  - overwrite a value the user entered
- **FR-006**: The answers autofill uses MUST be held by the extension, so a press makes no server call:
  - profile, email and remembered answers
  - work history and education
  - the résumé file, or the staged tailored résumé
- **FR-006a**: That copy MUST stay current. It refreshes after a cheap change check at most every 60 seconds while in use, and at once on sign-in or when the panel opens.
- **FR-006b**: That copy MUST be wiped on sign-out or account change.
- **FR-007**: Autofill MUST be startable from the on-page button, the side panel, and a keyboard shortcut. One press MUST fill every frame of the tab.
- **FR-008**: The on-page button MUST appear only on pages that look like an application. That means at least one identity field or a résumé upload, and not a sign-in, search or newsletter form.
- **FR-009**: Everything autofill draws on a page MUST be kept separate from the site's own styles and scripts, so the site can't restyle or break it.

**Review (Story 2)**
- **FR-010**: Every filled field MUST be outlined by source: profile, remembered, AI, or needs you.
- **FR-011**: The side panel MUST list:
  - every touched field, with source, value, Fix (using the field's real options), Show and Undo
  - the questions left for the user
  - Undo all
- **FR-011a**: The panel list MUST stay current across steps.
- **FR-012**: The on-page status MUST be one short line with a Review action that opens the side panel.

**Learning (Story 3)**
- **FR-013**: The extension MUST notice answers the user gave to unknown questions when they press Next, Continue, Save or Submit, or leave the page. It MUST offer them in the panel for review: keep or uncheck, edit, then Save. Nothing is saved without Save.
- **FR-014**: A Fix on a remembered or AI answer MUST be saved as a remembered answer.
- **FR-015**: Remembered answers MUST be matched to a choice field's options by meaning: Yes/No equivalents, starts-with, and same words.
- **FR-015a**: Two questions that differ in country, number or negation MUST never share an answer.

**Multi-step (Story 4)**
- **FR-016**: After one press, autofill MUST fill later steps of the same application in that tab as they appear. "Keep filling this application" is on by default and can be switched off.
- **FR-016a**: Keep-filling MUST stop when the tab leaves the site.
- **FR-017**: On a Workday-shaped application, autofill MUST:
  - create and fill one experience block per résumé job and one education block per school
  - fill dates so they hold
  - leave no half-filled date
- **FR-018**: The résumé MUST be read into work history and education once, when it's uploaded or first needed. The result is kept for that résumé.

**AI (Story 5)**
- **FR-019**: Leftover non-sensitive fields MUST be sent to the app's AI in one request per step, as question and options only. The AI must answer from the user's own data and give a confidence for each answer.
- **FR-020**: Confident AI answers MUST be filled and marked "check".
- **FR-020a**: Unsure AI answers MUST only be shown as suggestions, which need a tap to use.
- **FR-020b**: AI failure MUST never block or undo the instant fill.

**Everything else (Story 6)**
- **FR-021**: All current features listed in Story 6 MUST keep working, each covered by an automated test.
- **FR-022**: On install or update, the extension MUST put its current scripts into open tabs by itself, so no reload or refresh is needed.
- **FR-023**: Scout Results MUST offer **Save anyway** for jobs whose page wasn't copied. It saves title, company and link and marks the job as needing details. The extension then adds the full posting when the user opens that page.

**Testing**
- **FR-024**: The work MUST include a test lab of invented application pages, in the shapes of the common applicant systems and form styles:
  - a classic form
  - a framework-driven form with search dropdowns
  - a Workday-shaped multi-step application
  - yes/no buttons with a location look-up
  - an embedded other-site frame
  - hidden-inside components
  - an Easy-Apply-style pop-up
  - noise pages
  - prefilled pages
  - self-ID and consent sections

  Browser tests MUST load the built extension against a fake app server, and check each page's own form data. No real sites, accounts or personal data.
- **FR-025**: The project's automated checks (CI) MUST run the extension's unit and browser tests on every pull request.

### Key Entities

- **Autofill copy** (in the extension, per signed-in account):
  - profile, email and remembered answers
  - work history and education
  - résumé file, or the staged tailored résumé
  - a version stamp for the change check
- **Fill session** (per tab, not stored on the server):
  - each touched field, with its source, value and previous value
  - the questions left for the user
  - AI suggestions
  - newly noticed answers awaiting review
  - whether keep-filling is on
- **Résumé reading** (on the server, per résumé): work history and education read once from the résumé, plus when it was read.
- **Remembered answer** (existing): question, answer, how often used and when last used. Unchanged; choice answers can now be matched to options.

## Success Criteria *(mandatory)*

- **SC-001**: On every lab form, autofill puts the right value in at least 95% of the fields the invented person has answers for. It counts as filled no field whose page data doesn't hold the value.
- **SC-002**: With the extension's copy in place, a press fills the page in under 1 second, even with the fake server delaying every reply by 30 seconds.
- **SC-003**: A Workday-shaped 4-step lab application needs at most one press to fill every known field on all 4 steps.
- **SC-004**: An answer typed once in one lab form fills its reworded twin in another lab form after one Save.
- **SC-005**: Self-ID questions, consent boxes, essays and prefilled values are untouched on 100% of lab runs.
- **SC-006**: Every listed existing feature has a passing automated browser test, and CI runs them all.
- **SC-007**: After an extension update, an already-open tab is copied by a Scout run with no user action.

## Assumptions

- The user keeps reviewing and submitting every application themselves. Auto-submitting is out of scope permanently.
- **Desktop only:** Chrome on desktop is the only place the extension runs (phones have no extensions). The app's existing pages keep phone parity for everything the extension saves.
- **Free plan:** the AI stays the app's free hosted AI, as today. If its key is invalid, Story 5 simply adds nothing; Stories 1–4 don't depend on it.
- The **résumé file and staged résumé** keep today's sources. The extension's copy of the file is kept in the browser's local extension storage, which is never shared with sites.
- **Writing essays** ("Why do you want to work here?") stays with the AI apply helper and is out of scope for autofill.
- Exact layout details of real applicant systems change. The lab copies their **structure** (how fields are built and labelled), never their branding. Real-site checks are the user's first live try after merge.
