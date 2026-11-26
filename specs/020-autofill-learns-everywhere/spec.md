# Feature Specification: Autofill that learns everywhere, plus the section bugs

**Feature Branch**: `020-autofill-learns-everywhere`

**Created**: 2026-11-24

**Status**: Draft

**Input**: The user's rule, from real applications:
> "A field that says preferred name, Job Catcher should know that field should be Sam. Say it puts Samuel, I click on it with the selector, it shows me Samuel, I change it to Sam, then other applications that field that says preferred name is gonna be Sam … any question, any field, this is how it should work."

**What happens today:**
- Job Catcher fills every "Preferred First Name" box with the legal first name, because the profile has no preferred name.
- The pointer's "Always use this here" saves the answer for that one website only. The user taught "Sam" on three sites; the fourth site still got the legal name.

**Bugs seen on real applications:**
1. **Learning doesn't carry across sites**, for any field.
2. (Preferred name is solved by learning, US1: no new profile fields; the user doesn't want them.)
3. **Workday Work Experience:**
   - the title was cut at "(";
   - company and location were empty;
   - the description held a scrap of the title ("IT Systems & Automation) · Northwind Labs"), from Workday's own résumé reading;
   - Job Catcher left the whole section to the user.
4. **Workday Languages:**
   - several dropdown lists were left open, stacked on top of each other, with nothing chosen (Language; Comprehension 1 Beginner – 5 Fluent; "I am fluent");
   - the profile has nowhere to keep languages.
5. **One résumé for everything:** the user had a résumé tailored for one job, but Job Catcher uploads the same résumé everywhere.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correct it once, right everywhere (Priority: P1)

Job Catcher fills a box. The user sees it's wrong and corrects it, either by pointing at it and changing the answer, or by typing over it before moving on. From then on, **every application on every site** fills that same question with the corrected answer, even when the question is worded a little differently ("Preferred Name", "Preferred First Name", "Nickname", "What name do you go by?").

What goes where:
- Every correction becomes a **learned answer for that question, used on every site**, including questions the profile normally answers (it then wins over the profile for that question only).
- Exceptions, kept automatically:
  - A question about **one company** ("Are you an EY alumni?", "Have you worked for us before?", "Salary for this role") is remembered for **that company only**.
  - An **essay** ("Why do you want to work here?") is saved and offered with one tap, never filled on its own.
  - **Never learned:** self-identification (race, gender, veteran, disability), consent and agreement boxes, passwords, payment details.
- In the pointer box, the user can choose **Only this site** for a one-off answer.
- What the user taught **always beats** the profile's general answer and any guess.
- The "Sam" answers the user already taught on three sites **apply right away**, with nothing to redo.

**Why this priority**: it's the user's core rule for how Job Catcher should feel: answer once, never again.

**Independent Test**:
- On site A, Job Catcher fills "Preferred First Name" with the legal name. The user points, changes it to "Sam" and saves.
- On a different site B, the box labelled "Preferred Name" fills "Sam".
- On site C, "Legal First Name" still gets the legal name.
- Autofill memory in the app shows the learned answer "Sam" for preferred name, used on every site.

**Acceptance Scenarios**:

1. **Given** the user corrects a box with the pointer, **When** they save it, **Then** every later application on any site fills that question with the new answer.
2. **Given** the user types over a box Job Catcher filled and moves to the next page, **Then** the correction is learned the same way, with no extra press.
3. **Given** a non-profile question ("How did you hear about us?") corrected on site A, **When** the same or similarly worded question appears on site B, **Then** site B fills the corrected answer.
4. **Given** a question about one company, **When** it is corrected on that company's site, **Then** other companies never get that answer.
5. **Given** the user picks **Only this site**, **Then** the answer is used on that site only, and other sites keep the general answer.
6. **Given** the user already taught "Sam" on three sites before this feature, **When** the feature arrives, **Then** preferred-name boxes get Sam on every site with no further action.
7. **Given** a self-identification, consent, password or payment box, **Then** nothing typed there is ever learned.

---

### User Story 2 - Job, school, certification, language and website sections filled properly (Priority: P1)

On applications that ask for past jobs, schools, certifications, languages or websites in numbered blocks ("Work Experience 1", "Work Experience 2"…), Job Catcher:
- fills **each block from the matching profile entry**, in order (job title, company, location, from/to dates, "I currently work here", role description);
- presses the page's own **Add** button until there are as many blocks as the profile has entries (up to 10);
- **corrects boxes the site pre-filled wrongly**, for example from its own résumé reading, when the profile has the right answer;
- never changes a box the user edited themselves on this page;
- lets the user **undo** every change.

**Why this priority**: the user called these "the most tedious, annoying parts of applying".

**Independent Test**: on a Workday-shaped practice page with one pre-filled, wrong Work Experience block and a profile with three jobs:
- after one press there are three blocks, each matching the profile;
- the wrong title and description are corrected;
- a box the user edited first is left alone.

**Acceptance Scenarios**:

1. **Given** a profile with three jobs and a page with one empty block, **When** Autofill runs, **Then** two more blocks are added and all three are filled in profile order.
2. **Given** a block the site pre-filled with a wrong title, **Then** it is replaced with the profile's title, and Undo restores the page's value.
3. **Given** the user typed into a block's box before pressing Autofill, **Then** that box is not changed.
4. **Given** the profile has no entries of a kind, **Then** those blocks are left for the user, with a plain note.

---

### User Story 3 - Dropdown lists handled one at a time (Priority: P1)

For custom dropdown lists (Workday's pop-up lists, search-as-you-type pickers, multi-pick lists), Job Catcher handles **one list at a time**:
1. open it;
2. choose the matching option;
3. check the choice stuck;
4. close it, and make sure it closed, before touching the next.

If no option fits, it closes the list and leaves the box for the user. A list is **never** left open, and lists are never stacked.

**Why this priority**: the stacked-open lists made the Workday page unusable.

**Independent Test**: on a practice page with six Workday-style lists:
- one press fills every list that has a matching answer;
- no list is open afterwards;
- lists without a match are listed under "Needs you".

**Acceptance Scenarios**:

1. **Given** several custom lists, **When** Autofill runs, **Then** at most one list is ever open at a time, and none is open when it finishes.
2. **Given** a list without a matching option, **Then** it is closed and left for the user.

---

### User Story 4 - Languages kept in the profile (Priority: P2)

The profile gains a **Languages** list, editable in the app. Each language has:
- whether the user is fluent or native;
- levels for comprehension, reading, speaking and writing (and overall), from 1 Beginner to 5 Fluent.

Language blocks on applications are filled from it, adding blocks to match. Levels translate to each site's wording (Native, Fluent, Advanced, Intermediate, Basic, Elementary, Proficient…).

**Why this priority**: needed for the Workday Languages section, but fewer applications ask for it.

**Independent Test**: add English (fluent, 5s) and Spanish (levels 4) in the app. The Workday-shaped Languages page fills two blocks: languages, the "fluent" box, and each level.

**Acceptance Scenarios**:

1. **Given** two languages in the profile, **Then** two language blocks are filled with their levels.
2. **Given** a site that words levels differently, **Then** the closest wording is chosen (5 → Fluent/Native, 1 → Beginner/Elementary).

---

### User Story 5 - The right résumé for each job (Priority: P2)

A saved job can have **its own résumé**. The user picks it in the app on the job's page, or in Job Catcher on that job ("Résumé for this job: … · Change"). When Autofill runs on an application linked to that job, it uploads that résumé. Everywhere else it uploads the usual one. Job Catcher shows which file it will upload **before** filling.

**Why this priority**: valuable, but it only matters for jobs with a tailored résumé.

**Independent Test**: set résumé B for job X. Autofill on job X's application uploads B; on job Y's it uploads the usual résumé.

**Acceptance Scenarios**:

1. **Given** job X has its own résumé, **When** Autofill runs on job X's application, **Then** that résumé is uploaded, and the panel named it beforehand.
2. **Given** a job without one, **Then** the usual résumé is used, as today.

---

### User Story 6 - "Fill in your résumé again" pages, from the résumé you choose (Priority: P1)

Many applications make the user retype their whole résumé into boxes:
- jobs;
- schools;
- skills (often a type-and-pick list);
- certifications;
- languages;
- websites.

Today this fails at the root: **the user's résumé details were never read into the app** (0 jobs, 0 schools stored), so Job Catcher had nothing to fill these pages with.

What the user gets:
- **Each résumé has its own details** (jobs, schools, skills, certifications, websites). They are read from the résumé file automatically when it's uploaded, or by pressing **Read my résumé**, by a built-in reader. No AI is used. The user can check and edit them in the app on phone and computer.
- **The user chooses which résumé an application uses.** A saved job's own résumé (US5) is used for that job. The panel shows "Filling from: <résumé> · Change" and the user can switch before pressing Autofill. That one choice drives both the file uploaded and every jobs/schools/skills box.
- **Skills boxes are filled** from the chosen résumé's skills: typed and picked one by one in type-and-pick lists, or written as a comma list in a text box.
- Existing résumés are read once at release, so the user's current résumés have details without doing anything.

**Why this priority**: the user calls these pages "the most tedious, annoying parts of applying", and without stored details nothing in US2 can work.

**Independent Test**:
- Upload a sample résumé. The app shows its jobs, schools and skills, read by the built-in reader with no AI, and they can be edited.
- On the Workday-shaped practice page, choose résumé B in the panel. Jobs, schools and skills fill from B, and B is uploaded.

**Acceptance Scenarios**:

1. **Given** a résumé uploaded, **Then** its jobs, schools and skills are read with no AI and shown for checking.
2. **Given** two résumés with different details, **When** the user picks résumé B for an application, **Then** every section box and the upload use résumé B.
3. **Given** a skills type-and-pick list, **Then** each skill from the chosen résumé is typed and picked, skipping skills the site doesn't offer, and no list is left open.
4. **Given** the user edits a job in the app, **Then** the next Autofill uses the edited version.

### Edge Cases

- **Two different answers taught on different sites for the same general question:** the most recent wins everywhere, unless one was marked Only this site.
- **A correction to a box Job Catcher didn't fill** (it was empty): saving it is still learning. It goes to the profile if empty there, or as a saved answer.
- **Same words, different meaning** ("Name of your previous manager" vs "Name"): the full question is compared, never single words, so they don't collide.
- **A box inside a past-job block** ("Company", "Job Title"): never learned as a general answer; it belongs to that job entry.
- **Sites that remove and re-create blocks** while adding: Job Catcher waits for the new block to appear, and stops after a short wait if it doesn't.
- **"Add" buttons that open a pop-up form**: filled the same way, then saved with the pop-up's own Save. Never Submit.
- **Very long option lists** (countries, languages): it types to search where the list allows it; otherwise it scrolls the list to find the option.
- **A résumé linked to a job that was later deleted:** the usual résumé is used.
- **Phone:** Autofill memory, profile, languages and job résumés can all be edited on a phone. Job Catcher itself is computer-only.

## Requirements *(mandatory)*

### Functional Requirements

**Learning (US1)**
- **FR-001**: A correction made with the pointer, or by typing over a box before moving on, MUST be saved so every later application on any site fills that question with it.
- **FR-002**: Every correction MUST become a learned answer for that question, used on every site. The profile is not changed. A learned answer is used instead of the profile's value for that question.
- **FR-003**: Differently worded versions of the same question MUST be treated as the same question. Different questions that share words MUST NOT.
- **FR-004**: The order used for every box MUST be: this site's own answer, then the user's general learned answer, then the profile, then guesses.
- **FR-005**: Company-specific questions MUST be kept for that company only. Essays MUST be offered, never filled on their own. Self-identification, consent, agreement, password and payment boxes MUST never be learned.
- **FR-006**: The pointer MUST offer **Only this site**. Its default MUST be "every site".
- **FR-007**: Per-site answers taught before this feature MUST be promoted to the general answer for their question, once, at release.
- **FR-008**: Every learned answer MUST be visible, editable and removable on the Autofill memory page, labelled "Every site", "Only on <site>" or "Only for <company>".

**Languages (US4)**
- **FR-009**: The profile MUST hold a list of languages (language, fluent/native, comprehension, reading, speaking, writing, overall, each 1–5), editable in the app on phone and computer and included in the data export.
- **FR-010**: A learned answer for a name question (e.g. preferred name) MUST never be used for a different name question (e.g. legal first name).

**Sections (US2)**
- **FR-011**: Repeated blocks for jobs, schools, certifications, languages and websites MUST be filled from the matching profile entries, in order.
- **FR-012**: Job Catcher MUST add blocks with the page's own Add control until they match the profile's entries (maximum 10), waiting for each new block to appear.
- **FR-013**: Boxes the site pre-filled that differ from the profile MUST be corrected, with Undo. Boxes the user edited on this page MUST NOT be changed.

**Dropdowns (US3)**
- **FR-014**: Custom dropdown lists MUST be handled one at a time: open, choose, confirm the value, close, confirm closed. At no point may two lists be open, and none may remain open after a fill.
- **FR-015**: A list without a fitting option MUST be closed and listed under "Needs you".

**Résumé per job (US5)**
- **FR-016**: A saved job MUST be able to have its own résumé, set or changed in the app (job page) and in Job Catcher (linked job).
- **FR-017**: Autofill MUST upload the linked job's own résumé when it has one, otherwise the usual one, and name the file in the panel before filling.

**Résumé details (US6)**
- **FR-020**: Each résumé MUST have its own details (jobs, schools, skills, certifications, websites). They MUST be read on upload and on request by a built-in reader (no AI), and be viewable and editable in the app on phone and computer.
- **FR-021**: The résumé used for an application (the job's own, else the one picked in the panel, else the usual one) MUST drive both the uploaded file and all section and skills boxes. The panel MUST show and allow changing it before filling.
- **FR-022**: Skills boxes MUST be filled from the chosen résumé's skills (type-and-pick lists one at a time, or a comma list in text boxes).
- **FR-023**: Existing résumés with no stored details MUST be read once at release.

**Throughout**
- **FR-018**: Press-only, Super autofill and never-submit behaviour MUST stay as today. Every new change MUST be undoable. Nothing else in the app changes.
- **FR-019**: New account data MUST follow the security rules from spec 019: only the account owner can read or change it, and Job Catcher's pass may reach only what Job Catcher needs.

### Key Entities

- **Learned answer:**
  - a question (normalised) and an answer;
  - a scope: every site, one site, or one company;
  - a kind: everyday, company-specific or essay;
  - when it was last taught.

  It extends today's saved answers and taught boxes.
- **Profile addition:** languages (list of language entries).
- **Language entry:** language name, fluent/native, comprehension, reading, speaking, writing, overall (1–5).
- **Job résumé link:** a saved job and the résumé to upload for it (optional).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a single correction of any non-excluded question, 100% of later applications on other sites that ask the same question fill the corrected answer.
- **SC-002**: The user never has to teach the same answer twice. Measured: no question appears in Autofill memory as taught on more than one site with the same answer after promotion.
- **SC-003**: On the Workday-shaped practice pages, one press fills all job, school and language blocks to match the profile, leaving zero lists open.
- **SC-004**: On the user's next three real applications, the preferred-name box is "Sam" without any correction, and legal-name boxes keep the legal name.
- **SC-005**: Autofill on a job with its own résumé uploads that résumé 100% of the time.
- **SC-006**: No regression: every existing autofill practice page and test still passes.

## Assumptions

- **No AI in 020** (the owner, 2026-11-24: "no AI at all; we do AI later; right now it's gotta be perfect without"). Résumés are read by a built-in reader; Autofill never asks an AI. Boxes Job Catcher doesn't know are left under "Needs you". The AI comes back in a later phase.

- **Wording matching:** "the same question" is decided from the whole question's meaning (known profile questions and close wording), never from one shared word. When unsure, Job Catcher treats it as a new question, so it never guesses wrong.
- **Most recent wins** when the same general question was taught different answers.
- **Workday shapes:** the Workday-shaped practice pages follow Workday's published page structure. Other applicant systems (SuccessFactors, Greenhouse, Lever, iCIMS, Paycom) are covered by the same general rules.
- **Résumé files:** they are the ones already uploaded to the app. Uploading a new one from the job page uses today's upload.
- **Languages:** none are pre-filled for the user. They add their own in the app.
