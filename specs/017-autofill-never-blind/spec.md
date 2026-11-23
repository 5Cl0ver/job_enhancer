# Feature Specification: Autofill that never goes blind

**Feature Branch**: `017-autofill-never-blind`

**Created**: 2026-11-23

**Status**: Building (PR A: the fix + never stuck)

**Input**: The user, on a real Paycom application pop-up with v0.32.0: the panel found the application and offered Autofill, but a press said **"Nothing here matched your profile"** and listed nothing. "I don't want to have to keep going back and forth … There has to be a way for us to go around me giving you the HTML every single time … maybe a button … where it says no form on this page yet, different types of errors, where I can click and then it will read the page again … I've seen extensions where you can literally hover over the HTML … No more errors like this. I need it to work."

## What went wrong (the Paycom "Getting You Started" pop-up)

- **Finding the form worked (spec 016).** The panel said "Applying on Paycom", named the job, and offered **Autofill this page** first.
- **The press saw zero fields.** It found no questions at all: not even the text-message Yes/No or the privacy checkbox made the "Needs you" list. So this wasn't "no matching answers". The scanner was blind to the pop-up's boxes:
  - Legal First Name, Legal Last Name;
  - Email Address, Confirm Email;
  - a phone number beside a "+1" picker;
  - SMS consent Yes/No;
  - a privacy checkbox.
- **The user had no way out except sending a screenshot**, and Claude couldn't fix it without the page's HTML.
- **The underlying mistake:** each piece of the fill rests on one automatic guess (which frame, what counts as visible, what a field is). When a guess is wrong, nothing tells the user or the developer why, and the user can't help.

## The rule this feature sets

**Never blind, never stuck.** Every way a fill can fail ends with three things in the panel:
1. **Read the page again**: a deeper look, which usually fixes it.
2. **Point at it**: show Job Catcher the box, and it learns.
3. **Copy what Job Catcher saw**: a report with no personal details, which makes a fix one paste away, not a back-and-forth.

It stays stupid simple:
- nothing is drawn on the page unless the user starts pointing;
- it never submits;
- it never fills consent or self-ID questions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - It sees every box a person can see (Priority: P1)

On any page where I can see a form, including pop-ups, frames and page components, pressing Autofill finds every box I can see. It never treats a visible box as hidden because of an accessibility tag or a page wrapper.

**Why this priority**: This is the Paycom bug. Everything else is a backup for when this fails.

**Independent Test**: A Paycom-shaped lab pop-up reproduces the zero-field failure:
- an MUI-style dialog;
- the rest of the page marked `aria-hidden`, including the dialog's own ancestor;
- the same boxes as the real page.

On v0.32.0 this finds 0 fields. After this feature, it fills legal first and last name, email, confirm email and phone, and lists the SMS question and the privacy checkbox under "Needs you".

**Acceptance Scenarios**:

1. **Given** a pop-up inside an element marked `aria-hidden="true"`, `inert` on its siblings, or a page-wide wrapper, **When** I press Autofill, **Then** every box I can see is found and filled or listed.
2. **Given** the form is in a frame the page created without an address (`about:blank`, `srcdoc`), **When** I press Autofill, **Then** it is found.
3. **Given** a press finds no fields at all, **Then** Job Catcher automatically reads the page again with its deeper look before reporting anything, and only then tells me what it found.

---

### User Story 2 - When it fails, one tap fixes it or explains it (Priority: P1)

Every failure state in the panel offers the same three actions:
- **Read the page again**
- **Point at a box**
- **Copy what Job Catcher saw**

The failure states are:
- no form on this page;
- nothing matched;
- filled fewer than expected;
- page needs a refresh;
- taking too long.

**Why this priority**: The user must never be stuck or need Claude to see the HTML.

**Independent Test**: For each failure state on a lab page:
- the three actions are shown;
- Read again re-scans every frame;
- the report is copied and contains labels, field types, frames and skip reasons, but no values or personal details.

**Acceptance Scenarios**:

1. **Given** "No form on this page yet", **When** I press **Read the page again**, **Then** Job Catcher injects a fresh reader into every frame, scans with the deeper look, and updates the status within 2 seconds.
2. **Given** any failure, **When** I press **Copy what Job Catcher saw**, **Then** a plain-text report is on my clipboard. It includes:
   - the page's address host (not the full path, which can hold IDs);
   - each frame and its field count;
   - each field's label, type and what Job Catcher decided, with the reason for any skip.

   It never includes the value of any field or anything from my profile. The panel says "Copied: paste it to Claude".
3. **Given** I paste that report to Claude, **Then** it is enough to reproduce the page as a lab page without asking me for HTML.

---

### User Story 3 - Point at a box, and it learns (Priority: P2)

I press **Point at a box** in the panel. On the page, whatever I hover is outlined. I click a box, or a whole form. Then:
- **A box:** the panel asks "What goes here?", with my profile answers to choose from (First name, Email, Phone…) plus "Something else (type it)". It fills the box right away. Next time on this site it fills it by itself.
- **A whole form:** Job Catcher fills inside that form even if it didn't think it was one.

Esc or the panel's Cancel stops pointing. Nothing is drawn on the page when I'm not pointing.

**Why this priority**: This is the user's own escape hatch for any page no automatic reader understands, and it makes the extension better on every site the user teaches.

**Independent Test**: On a lab page whose box has no label at all:
- point, click, choose "Email";
- the box fills;
- reload the page and press Autofill: the box fills by itself.

Pointing works:
- over a modal pop-up;
- inside a page component (shadow DOM);
- inside a frame.

**Acceptance Scenarios**:

1. **Given** pointing mode, **When** I hover a box inside a modal pop-up, **Then** the box is outlined above the pop-up. Clicking selects it and does not click the page.
2. **Given** I taught "Email" for a box on a site, **When** I come back (even after the page's own CSS class names change), **Then** the same box is recognised by its label, name, type and position, and filled.
3. **Given** I chose a box that is a consent, self-ID or password field, **Then** Job Catcher refuses to learn it and says why.
4. **Given** the taught answer no longer matches anything on the site, **Then** it is ignored, never filled into the wrong box. Taught boxes are listed in Settings, where I can remove them.

---

### User Story 4 - Last-resort reader (Priority: P3)

If the normal reader and the deeper look both find nothing, but the page clearly has boxes, Job Catcher offers one more reader that sees the page the way assistive technology does. It asks first, because Chrome shows a "debugging this browser" bar while it runs.

**Why this priority**: It's rarely needed once Stories 1–3 exist, and it has a visible cost (a Chrome warning bar and an extra permission), so it's optional and asks first.

**Independent Test**: On a lab page built so the page reader is blocked, the panel offers "Try the deep reader". After the user accepts, it lists and fills the boxes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Visibility MUST be judged by what's on screen, not by accessibility attributes. An element is visible when:
  - it has size;
  - it isn't `display:none`, `visibility:hidden` or fully transparent (`checkVisibility` where available);
  - it is not inside a closed `<details>` or a `hidden` element that has no size.

  `aria-hidden` and `inert` on an ancestor MUST NOT hide a box with size on screen.
- **FR-002**: When a press finds zero fields in every frame, Job Catcher MUST automatically:
  - re-inject the autofill script into all frames of the tab, including `about:blank` and `srcdoc` frames;
  - re-scan with the deeper look;
  - only then report.
- **FR-003**: Every failure state in the panel MUST show **Read the page again**, **Point at a box** and **Copy what Job Catcher saw**.
- **FR-004**: The report MUST contain only:
  - the host;
  - the frames, with their hosts and field counts;
  - each field's label (cut to 80 characters), kind, autocomplete/name/id hints (cut to 40), visibility facts and decision/skip reason;
  - the extension version.

  It MUST NOT contain field values, profile data, or the page's text beyond labels.
- **FR-005**: Pointing mode MUST:
  - outline the hovered element in a layer above the page (including above modal dialogs);
  - select on click without the page receiving that click;
  - work inside open and closed shadow roots and in every frame;
  - stop on Esc, on Cancel in the panel, or after a choice.
- **FR-006**: A taught field MUST be stored per site as a **fingerprint**: label text, kind, name, id (unless it looks auto-generated), autocomplete, placeholder, and its position among the form's fields, together with the profile key or the custom answer. It MUST NOT be stored as a CSS path. Matching MUST need a strong fingerprint score and fill at most one box per taught entry.
- **FR-007**: Teaching MUST refuse consent, self-ID, password and payment fields.
- **FR-008**: Taught fields MUST be listed in the panel's Settings, with Remove. They are stored in the user's account so they work on every computer, falling back to on-device storage if the server can't be reached.
- **FR-009**: The deep reader (Story 4) MUST be off until the user accepts it in the panel, and MUST explain the Chrome bar before asking for the permission.
- **FR-010**: Nothing MUST be drawn on the page outside pointing mode (spec 016 decision), except the existing filled-field outlines.

### Key Entities

- **Scan report**: frames → fields, each with label, kind, hints, visible facts, and decision/reason. No values.
- **Taught field**: site, fingerprint, profile key or custom answer, created and last-used dates, use count.

## Success Criteria *(mandatory)*

- **SC-001**: The Paycom-shaped lab pop-up: 0 fields on v0.32.0, and all 7 boxes found after the fix (5 filled, 2 listed for the user).
- **SC-002**: Every failure state shows the three actions (e2e), and the copied report passes a no-values check: none of the profile's values appear in it.
- **SC-003**: Point → choose → reload → Autofill fills the taught box on its own, on a page with an unlabelled box, inside a modal, a shadow root and a frame.
- **SC-004**: After a "no fields" press, the automatic deeper look and its result line appear within 3 seconds.
- **SC-005**: No regressions: the spec 015 and 016 suites stay green.

## Assumptions

- Lab pages are modelled on public structure (MUI v4 dialog and modal manager behaviour). No real employer pages or personal data appear in tests.
- The report is copied to the clipboard by the user's own press. Nothing is sent anywhere automatically.
- Out of scope:
  - the "Claude applies" mode;
  - sending reports to the server automatically (a possible later step, opt-in only).
