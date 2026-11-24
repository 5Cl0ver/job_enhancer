# Feature Specification: Autofill memory — saves everything, easy to change

**Feature Branch**: `018-autofill-memory`

**Created**: 2026-11-23

**Status**: Building

**Input**: From the user's real applications with 0.33.x:
- "Make it automated so it saves everything we do, but I have the option to change it easily, then and there, for the next application, or view it."
- "I need a dedicated page for this stuff, not in Settings."
- "When I click a box, show what's saved for that field and let me customize it, change it or save something. If I click on one that's already filled, auto-save it."
- "I love that the next page just autofills… maybe a checkbox called Super autofill."
- **Bug:** in an Employment section, the boxes for a past job's address were filled with the user's home address.

**User decisions (2026-11-23):**
- Super autofill is **on** by default.
- The user said "you choose" on everything else. Claude chose, in plain words:
  - **Profile additions** (a field the profile is empty for) save automatically. A **different** value from the profile is used on that application, and the panel offers "Update profile?" with one tap, so one typo never spreads everywhere.
  - **Company-specific answers** ("Have you worked for *us* before?", "salary for *this role*") are saved for that company's site only.
  - **Essays** ("Why do you want to work here?") are saved as reusable answers the user can pick with one tap, but are never filled on their own.

## User Stories

### US1 — Super autofill (P1)

A **Super autofill** checkbox sits under the Autofill button.
- **On (default):** after the first press on an application, every next page or step fills by itself.
- **Off:** nothing fills without a press.
- The choice is remembered on this computer and on every other Chrome where the user is signed in.

**Test:**
- With it on, step 2 of the Workday lab fills without a press.
- With it off, it doesn't fill until the user presses.

### US2 — It saves what you answer, automatically (P1)

When the user moves on (Next, Continue, Submit, or leaving the page), what they typed or chose for questions Job Catcher didn't know is **saved**. The panel says "Saved 3 answers" with each answer's **Edit** and **Undo**.

What gets saved, and how:
- **Company-specific questions** are saved for that site only.
- **Essays** are saved as reusable answers. They're offered with "Use saved answer", never auto-filled.
- **Profile fields:**
  - empty ones are filled in the profile automatically;
  - different ones stay as a one-tap "Update profile?".
- **Never saved:** self-identification, agreements, passwords and private details.

**Test:**
- On the lab, a typed answer is in the account without any press.
- The next application fills it.
- Undo removes it.
- A company-specific answer never fills on another site.

### US3 — Inspect and teach any box (P1)

**Point at a box** shows, for the clicked box:
- what Job Catcher thinks it is ("Preferred name, from your profile", or "Not known yet");
- an **editable value**: the page's value if the box has one, else what's saved;
- buttons: **Fill once** · **Always use this here** · **Update my profile** (only for profile answers).

Clicking a box that **already has something in it** saves that value for this box on this site automatically, and says so: "Saved 'X' for this box · Undo". The profile is not changed unless the user presses Update my profile.

**Test:**
- Point at a box filled by the user. It's saved without a press, Undo removes it, and the next visit fills it.
- Edit the value and choose Fill once: nothing is remembered.

### US4 — A dedicated "Autofill memory" page in the app (P1)

A new page, **Autofill memory**, in the app's sidebar. It has:
- **Your profile** (the application profile, edit in place).
- **Saved answers**, searchable:
  - "only for <site>" marks;
  - essays shown as saved answers;
  - usage counts;
  - edit and delete.
- **Boxes you taught**, by site, with edit (the answer or profile choice) and delete.

The panel links to it ("Open Autofill memory", and "Edit in app" on a saved answer, which opens the page filtered to that answer). Settings links to it instead of holding the cards.

### US5 — Employment sections never get your personal details (P1)

A box inside an **employment / work history / experience / education / references** section is never filled with the user's own name, address, city, state, zip, phone or email. The section is known from:
- the heading above or around it;
- a fieldset legend;
- a field name like `employer_city` or `job1_address`.

Inside employment blocks, the company, job title, start and end dates, and the job's city and state are filled from the résumé's work history, one block per job, in order. Everything else (the employer's street address, phone, supervisor) is left under "Needs you", marked "From your job history".

**Test:** a lab page with personal info followed by two employer blocks.
- Personal fields fill.
- The employer blocks get the résumé's jobs.
- The user's home address and phone appear in no employer block.

## Success criteria

- **SC-001:** None of the 0.33.1 behaviours regress. The spec 015, 016 and 017 suites stay green.
- **SC-002:** Every story's test passes in real Chromium against the lab, with no real data.
- **SC-003:** Nothing that's never saved can be saved by any path: auto-save, inspect, or "always use here". This is unit-tested.
