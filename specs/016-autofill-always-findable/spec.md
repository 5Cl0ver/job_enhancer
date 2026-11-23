# Feature Specification: Autofill you can always find, that always works

**Feature Branch**: `016-autofill-always-findable`

**Created**: 2026-11-23

**Status**: Built

**Input**: User, on a Paycom application (a pop-up form on paycomonline.net): "where do i auto fill its not easy still … idk how to auto fill … like its not obvious at all … i dont want to have to keep coming back to you over and over … i need it to be stupid simple for me to use."

## What went wrong (the Paycom page)

- **The side panel showed only "Save this job".** It offers Autofill only when the web address looks like an application (has "apply", or is a known applicant site). Paycom's address has neither.
- **The on-page Autofill button never appeared, or was hidden.** It appears only when the page passes a guess: two fields the app recognises, one of them about the person.
  - Paycom's form opens later, in a pop-up.
  - Its labels sit after the boxes ("floating labels"), which the reader didn't see, so the guess failed.
  - A cookie banner covered the bottom-right corner, where the button lives.
- **The keyboard shortcut works, but nobody knows it.** Worse, Simplify Copilot uses the same key (Alt+Shift+F). If it's installed, Chrome may have silently given our shortcut to Simplify.
- **The underlying mistake:** Job Catcher decides for the user whether a page is "an application". When the guess is wrong, there is no way to fill at all from the obvious places.

## The rule this feature sets

**Stupid simple:** on any page with a form, there is ONE obvious Autofill button, always in the same place: the extension's side panel. One press fills. No settings, no guessing, no reading instructions.

**User decision (2026-11-23): no button on the page.** "Don't put it on the page, put it in the extension so I can manage it all there … for now I need easy functionality and an easy way to know something is happening or not."
- Everything is controlled from the side panel and the toolbar icon.
- The on-page Autofill pill is removed.
- The only thing drawn on the page is the existing outline on fields that were filled, which shows what changed.
- Nicer on-page effects are a later idea.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The button is always there, and I always know what's happening (Priority: P1)

I'm on any page with a form: an applicant site, a company site or a pop-up that just opened.
- The extension's toolbar icon shows a ⚡ badge: this page can be filled.
- Clicking the icon opens the side panel, and its first and biggest thing is **⚡ Autofill this page**.

The panel always shows one status line, so I know if something is happening or not:
- "Looking at this page…"
- "Form found: ready to fill"
- "Filling… 7 of 15"
- "Done: 12 filled · 2 need you"
- "No form on this page yet"
- or a plain problem (signed out, app waking up, page needs a refresh)

I never have to know the web address, a shortcut, or whether the page "counts".

**Why this priority**: Nothing else matters if the user can't find the button or can't tell whether it worked. This is the bug.

**Independent Test**: Lab pages with no "apply" in the address:
- a Paycom-like pop-up form;
- a form behind a cookie banner and a native modal;
- a form inside a frame;
- a plain contact-style form with 3+ fields.

On every one:
- the panel shows Autofill as its first action, with "Form found";
- the toolbar shows ⚡;
- pressing fills, with progress then a result line.

**Acceptance Scenarios**:

1. **Given** a page whose form opens in a pop-up after a click, **When** the pop-up appears, **Then** within about a second the panel's status changes to "Form found: ready to fill" and the badge shows ⚡.
2. **Given** I press Autofill, **Then** the status shows progress while it works ("Filling…" with a count), and ends in one result line. It never stays silent or spins forever: after 20 s it says what went wrong.
3. **Given** a page with a form that doesn't look like an application (a contact form), **When** I open the panel, **Then** Autofill is still offered: smaller, below "Save this job", but there and one press away.
4. **Given** a sign-in page (a password box) or a page with fewer than 3 fields, **Then** there is no badge and no big button. A small "Fill this page anyway" link in the panel and the shortcut still fill.
5. **Given** a page with no form, **Then** the panel says "No form on this page yet: open the application and the Autofill button appears here", never a blank or confusing state.

---

### User Story 2 - One press fills it, on the sites people really apply through (Priority: P1)

Pressing Autofill fills every field the app knows, on:
- the big applicant systems: Paycom, Paylocity, UKG, ADP, Dayforce, BambooHR, iCIMS, Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Jobvite, JazzHR, Rippling and Taleo;
- custom company sites.

This includes forms in pop-ups, in frames, and with labels in any of the common places.

**Why this priority**: A visible button that fills nothing is the same failure.

**Independent Test**: A lab page per label style:
- label before the box
- label after the box (floating)
- label wrapping the box
- aria-label
- placeholder only
- label in a table cell
- label in a sibling element

Plus a Paycom-like pop-up. Each fills name, email, phone, address and links, and leaves consent and self-ID boxes alone.

**Acceptance Scenarios**:

1. **Given** the Paycom-like pop-up with floating labels, a phone box with a "+1" prefix, a privacy checkbox and a consent radio, **When** I press Autofill, **Then** name, email, phone (without a doubled +1), address and city fill. The privacy checkbox and consent radio stay untouched and are listed under "Needs you".
2. **Given** a press that finds nothing it knows, **Then** the panel says so plainly ("Nothing here matched your profile: the fields are listed below for you"), never silence.
3. **Given** a form inside a frame from another site, **When** I press Autofill in the panel, **Then** the frame fills.

---

### User Story 3 - It tells me what to do next, in one line (Priority: P2)

After a press, the panel's top line says exactly one next thing: "12 filled · 2 need you · check them, then submit on the page". "Needs you" fields are one tap from being shown on the page.

**Independent Test**: After filling the Paycom-like page, the panel shows one line with counts and a single next step, and "Show" scrolls to and highlights each "Needs you" field.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The side panel MUST show Autofill on every page whose frames hold a fillable form, whatever the address. It is the top card when the page looks like an application or the form opened while the panel was open, and below "Save this job" otherwise.
- **FR-002**: A page frame MUST count as "has a form" when it has 3 or more visible fillable fields and no visible password box, OR it passes the application check. The check MUST re-run when a pop-up or new step appears.
- **FR-003**: No Autofill button MUST be drawn on the page (user decision). The on-page pill is removed; the filled-field outlines stay. The panel MUST show a status line at all times: looking / form found / filling N of M / done / no form / problem. A press MUST end in a result line or, after 20 s, a plain "this is taking too long" with a retry.
- **FR-004**: The toolbar icon MUST show a ⚡ badge when the page can be filled, and briefly the filled count (or "!") after a press.
- **FR-011**: The panel MUST show the real keyboard shortcut assigned to Autofill, or "Set a shortcut" when Chrome gave it none (another extension, such as Simplify, can take the same key). The default key moves from Alt+Shift+F (Simplify's) to Alt+Shift+J.
- **FR-005**: Pressing Autofill from the panel, the shortcut or the toolbar MUST fill every frame that has a form, not only frames that pass the application check.
- **FR-006**: Field reading MUST find the question for a box when the label is:
  - before it, after it (floating), or wrapping it;
  - linked by id, aria-label or aria-labelledby;
  - in a table cell beside it;
  - the placeholder.

  The order MUST be the most reliable first.
- **FR-007**: The applicant-system address list MUST cover at least the systems named in Story 2. It MUST be one shared list used by both the page and the panel.
- **FR-008**: Phone boxes with a separate country-code prefix MUST be filled with the national number only.
- **FR-009**: Consent, privacy, terms and self-identification fields MUST never be filled. It never submits.
- **FR-010**: Every outcome of a press MUST produce one plain-language line in the panel, including filled nothing, signed out, app asleep and page not reachable.

### Key Entities

- **Form presence (per frame)**: has a form (yes/no), field count, looks like an application (yes/no), recognised person fields. It is reported to the panel and the toolbar badge.

## Success Criteria *(mandatory)*

- **SC-001**: On every lab page (US1 and US2 lists), the panel's Autofill button is visible without scrolling within 1 second of the form appearing: 100%.
- **SC-002**: On every lab page, including the one with a native modal and a cookie banner, the panel's status reaches "Form found" and a press ends in a result line: 100%. No Job Catcher button is drawn on any page.
- **SC-003**: On the Paycom-like page, one press fills ≥ 6 profile fields and fills 0 consent or self-ID fields.
- **SC-004**: Label styles: each of the 7 label styles is read correctly in unit tests.
- **SC-005**: A first-time user finds Autofill with no instructions. Measured by the panel's first visible button on a form page being Autofill (e2e assertion).

## Assumptions

- Fake lab pages are modelled on the public structure of these systems. No real employer pages or personal data appear in tests.
- The existing fill engine (spec 015) stays. This feature changes when and where Autofill is offered, how questions are read, and the address list.
- Out of scope: "Claude applies" mode (a later feature), and auto-submitting.
