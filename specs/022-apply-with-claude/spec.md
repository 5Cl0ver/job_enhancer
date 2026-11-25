# Feature Specification: Apply with Claude

**Feature Branch**: `022-apply-with-claude` (part A) · `022-apply-runs` (part B) · `022-apply-app` (part C) · `022-apply-job-catcher` (part D)

**Created**: 2026-11-24

**Status**: Draft

**Input**: The owner, 2026-11-24 (with an idea from a friend):
> "I see a job, I'm like, ooh, I want to apply to this job. Then we have like a button that's like auto apply with Claude … kind of like a loading period, like the Job Scout … it gives me a copy, paste it in, and then kind of goes through the steps … our app shows … this is where it's at in this stage, gets its resume, can save it to that job."
>
> "After Claude asks us the questions, I'm the one answering them … makes the resume … I can always view it and/or change it out easily … beginning, the middle, the end … makes me a FULL résumé … fills the application … takes photos of every page … stops before submit … I'll check the photos on my phone or the computer … then I can either type to Claude in the extension, or Claude on my phone … 'looks good, submit' … or 'fix this' and it'll fix it … or I can just submit it myself with a button if I'm on the computer."
>
> "The résumé output is still trash. I need it to ask me, like Claude does, if I have done specific things from that listing that are not on my résumé … one big mega résumé that I leave in the app in settings that I can choose, then split them off."
>
> "Sometimes it's grabbing the description when it says 'more': it's not pressing it, it's saving 'more'. Some titles on Indeed and other pages, and the company name, aren't saving properly."
>
> "Sign up for me: maybe I can have it sign up for me also with email and password, I securely save it somewhere."

**What exists today** (survey of the code and the live data, 2026-11-24):
- **Claude Scout** already runs this way. A Start button opens a run. The app shows one line to paste into Claude in Chrome. Claude asks the app's connector what to do, and the app shows progress live. Job Catcher sends page copies while a run is open.
- **Job Catcher** fills applications from the profile on any site when the user presses Fill. It uploads the job's own résumé when one is chosen. It already notices when an application is submitted. It never takes photos.
- **Résumés:**
  - Each job can have its own résumé (spec 020).
  - A PDF maker turns a written résumé into a clean PDF (letter size, Calibri-like font).
  - Today's "tailor my résumé" sends the résumé and the listing to an AI once, with no questions. The owner calls the result trash. The free AI for writing is paused.
  - There is no "master" résumé. There is no place to keep things the user told Claude that aren't on the résumé.
- **Live data, last 60 days:**
  - 10 LinkedIn descriptions end in "… more" (the button's text).
  - Indeed titles were saved as the browser tab's name, for example "Systems Engineer - Tier II - Clackamas, OR 97015 - Indeed.com".
  - A LinkedIn job was saved with its company name as its title.
  - "ZipRecruiter" was saved as a company, and an iCIMS company as "careers-nscglobal".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Job Catcher saves the whole job, correctly (Priority: P1, part A)

When the user saves a job, it keeps the full description, never the "… more", "Show more" or "See more" button text. When a site hides the rest of the description behind such a button, Job Catcher opens it first. Titles never carry the site's name or the tab's location tail. A company is never the job board's own name. A title that is just the company's name is not used as the title.

**Why this priority**: Claude's questions and the tailored résumé are only as good as the listing they read.

**Independent Test**: Save a LinkedIn job whose description shows "… more". The saved text ends with the real last sentence. Save an Indeed job page whose tab title reads "Title - Town, ST 00000 - Indeed.com". The saved title is just "Title".

**Acceptance Scenarios**:
1. **Given** a description that ends with a "… more"/"Show more"/"See more"/"Read more"/"Show less" button, **When** the job is saved, **Then** that button text is not part of the description.
2. **Given** a page whose description opens fully only after pressing "See more" (or similar), **When** the user presses Save, **Then** Job Catcher presses it first and saves the full text.
3. **Given** a title ending in "- Indeed.com", "| LinkedIn" or "- ZipRecruiter", with or without a town or state before it, **When** the job is saved, **Then** only the job title is kept.
4. **Given** a page where the only company found is "ZipRecruiter", "Indeed", "LinkedIn" or "Glassdoor", **When** the job is saved, **Then** the company is left for the next source (or blank to fill in), never the board's name.
5. **Given** a hiring-site address like `careers-nscglobal.icims.com`, **When** the company comes from the address, **Then** it reads "nscglobal", without the "careers-" part.
6. **Given** a title that equals the company's name, **When** another source has a real title, **Then** the real title wins.

---

### User Story 2 - "Apply with Claude" from any saved job (Priority: P1)

On a saved job's page there is an **Apply with Claude** button next to Apply. Pressing it opens the job's **application page**, which shows the run's progress in six steps:

**Start → Questions → Résumé → Application → Your review → Sent**

At the Start step it shows, like Scout, the one line to paste into Claude in Chrome ("Apply to my job with the Job Enhancer connector."), with a Copy button and a "Waiting for Claude…" line. From then on the page moves through the steps by itself as Claude works. Each step shows what happened. A Stop button is always there.

Only one application runs at a time. Pressing the button while another is open offers to go to that one.

A small banner at the top of every app screen (phone and computer) says when Claude needs the user, with a link: "Claude has 4 questions for you: IT Engineer at Acme".

**Independent Test**: Press Apply with Claude on a saved job. The page shows the line to copy and "Waiting for Claude". Paste it into Claude in Chrome. Within seconds the page moves to "Reading the job".

**Acceptance Scenarios**:
1. **Given** a saved job, **When** the user presses Apply with Claude, **Then** an application run opens on that job and its page shows the line to copy.
2. **Given** an open run, **When** Claude calls the connector, **Then** the page shows the current step within about 5 seconds.
3. **Given** an open run elsewhere, **When** the user presses Apply with Claude on another job, **Then** they're told one is already going and offered a link to it (or to stop it).
4. **Given** a run with no activity for 3 hours, **When** anyone looks at it, **Then** it shows as stopped ("No activity for 3 hours").
5. **Given** the phone, **When** the user opens the application page, **Then** every step works there except pasting into Claude in Chrome. The page says that part happens on the computer.

---

### User Story 3 - Claude asks about what the listing wants that the résumé doesn't show (Priority: P1)

Claude compares the listing with the user's **master résumé** and with the things the user already told Claude. Then it asks short questions about the gaps, for example: "The listing asks for Intune. Have you used it? Where, and what did you do with it?" Each question says why it's asked.

The user answers on the application page (phone or computer): Yes/No plus a box for details. They can skip any question or answer in the Claude chat instead. "Done, make my résumé" sends the answers.

Every answer the user gives is kept as a **thing you've told Claude**. Claude never asks it again for later jobs. The list can be seen, edited and deleted in Settings › Résumés.

**Acceptance Scenarios**:
1. **Given** Claude asked 5 questions, **When** the page loads, **Then** each shows its question, why, Yes/No and a details box.
2. **Given** the user answered 3 and pressed "Done, make my résumé", **When** Claude next checks, **Then** it gets the 3 answers and knows the other 2 were skipped.
3. **Given** the user answers in the Claude chat instead, **When** Claude records them, **Then** they show as answered on the page too.
4. **Given** an answer from an earlier job, **When** a new run starts, **Then** Claude receives it and doesn't ask it again.
5. **Given** Settings › Résumés, **When** the user edits or deletes a thing they told Claude, **Then** later runs use the change.

---

### User Story 4 - A full résumé for this job, from the master résumé (Priority: P1)

After the questions, Claude writes a **full résumé** for this job. It keeps every real job, school and skill, with nothing dropped to make it short. It rewrites and orders the content so what this job asks for stands out, and it adds what the user confirmed in the answers. It never invents anything. It uses the same clean layout the app's PDF maker uses.

The app saves it to the job:
- as **this job's résumé**, a PDF named "First Last - Résumé.pdf", which Job Catcher uploads into this job's application;
- as a document on the job, which can be viewed, edited, copied and downloaded.

At any time (before, during or after the application), the user can open it, edit its text (the PDF is remade), or switch the job to any other résumé. The app doesn't stop to show the résumé. It is on the page, and the review step shows which résumé was attached.

The user keeps **one master résumé**, the big everything résumé. They pick it in Settings › Résumés from their uploaded résumés. If none is picked, the usual résumé is the master. Résumés made for jobs are listed apart ("Made for a job") and can be deleted.

**Acceptance Scenarios**:
1. **Given** Claude saved a résumé for the run, **When** the user opens the job, **Then** "Résumé for this job" shows it, with View, Edit text and Change.
2. **Given** the user edits the text and saves, **When** Job Catcher next uploads this job's résumé, **Then** it uploads the remade PDF.
3. **Given** the résumé Claude sent is missing its name heading or sections, **When** it's saved, **Then** the connector refuses with a plain reason so Claude fixes it.
4. **Given** a master résumé is chosen, **When** Claude asks for the master profile (this run or any other Claude chat), **Then** it gets the master résumé plus the things the user told Claude.
5. **Given** a made-for-a-job résumé, **When** the user deletes it in Settings, **Then** jobs that used it go back to the usual résumé.

---

### User Story 5 - Claude fills the application; Job Catcher takes a photo of every page (Priority: P1)

Claude opens the application:
- On each page it first asks Job Catcher to fill what it knows (profile, saved answers, this job's résumé). Then it fills the rest itself.
- Before moving to the next page it tells the app the page is done. Job Catcher then takes **photos of the whole page**, top to bottom, plus a list of every question and its answer.

The application page fills in as it goes: Page 1 "My information" (3 photos, 14 answers), Page 2 "My experience"… Answers Claude wrote itself (such as "Why do you want to work here?") are marked "Claude wrote this". Boxes left empty are marked.

**Acceptance Scenarios**:
1. **Given** a page Claude finished, **When** Claude says so, **Then** Job Catcher takes the photos within about 15 seconds, and they appear on the application page.
2. **Given** Job Catcher isn't installed or signed in, **When** Claude says a page is done, **Then** the page is still listed with Claude's own list of answers and "No photo: Job Catcher didn't answer", and Claude carries on.
3. **Given** Claude asks Job Catcher to fill a page, **When** Job Catcher finishes, **Then** Claude gets what was filled and what still needs an answer.
4. **Given** a page longer than the screen, **When** photos are taken, **Then** they cover it top to bottom (at most 8 per page) and the page's scroll is put back.
5. **Given** photos, **When** 30 days pass after the run ends, **Then** they are deleted. The list of answers stays with the job.

---

### User Story 6 - It stops before Submit; the user reviews and decides (Priority: P1)

At the last page Claude stops and doesn't press Submit. The application page shows **Your review**: every page's photos and answers, the résumé attached, and three choices:
- **Submit**: Claude presses Submit, takes a photo of the confirmation, and the job moves to Applied.
- **Fix something**: the user types what's wrong ("My start date should be January"). Claude fixes it, takes new photos and asks again.
- **I'll submit it myself** (computer): the user presses the site's Submit. Job Catcher notices, and the run ends as Sent.

The user can also tell Claude directly: in the Claude in Chrome chat, or in the Claude app on the phone (the connector is the same). Claude records what they said, and the page shows it.

As a safety net, while a run is waiting for the user's OK, **Job Catcher blocks Submit buttons** on that application's pages. A Submit press before the OK does nothing, and Claude is told to wait.

**Acceptance Scenarios**:
1. **Given** Claude reached the last page, **When** it says the application is ready, **Then** the run moves to Your review and the top banner says "Ready for your review".
2. **Given** the user presses Submit, **When** Claude checks, **Then** it's told to submit. After the confirmation photo the run is Sent and the job is in Applied with today's date.
3. **Given** the user sends a fix, **When** Claude checks, **Then** it gets the note. The review starts round 2 after Claude says it's ready again.
4. **Given** "I'll submit it myself", **When** the user presses the site's Submit, **Then** the run ends as Sent and the job moves to Applied.
5. **Given** a run waiting for review, **When** anything presses a "Submit application"-type button on that application's site, **Then** Job Catcher stops it and the run log says so.
6. **Given** the user tells Claude in a chat "looks good, submit", **When** Claude records it, **Then** the page shows "You told Claude: looks good, submit" and the run continues as if Submit was pressed.

---

### User Story 7 - When Claude is stuck, it asks the user (Priority: P2)

When Claude can't go on, it tells the app what it needs, and the top banner says "Claude needs you". Examples: a sign-in or sign-up page, a CAPTCHA, a question only the user can answer, or a site that won't load. The page shows what to do and a **Done, keep going** button. Claude also says it in the chat.

**Sign-ups:** Claude fills the email and the details. The **password is the user's**: Chrome offers a strong password and saves it in the user's Google Password Manager, which syncs to the phone. The app never stores site passwords.

**Acceptance Scenarios**:
1. **Given** Claude reaches a sign-in page, **When** it asks for help, **Then** the page shows "Sign in to {site}, then press Done, keep going".
2. **Given** the user pressed Done, keep going, **When** Claude checks, **Then** it carries on.
3. **Given** any run, **When** it ends, **Then** no password was ever sent to or stored by the app.

---

### User Story 8 - What you sent stays with the job (Priority: P3)

After a run is Sent, the job page shows **What you sent**: the date, the résumé attached, the list of answers per page, and the photos (for 30 days), with a link to the run's page. Before an interview, the user can see exactly what they told this company.

### Edge Cases

- **The posting is closed**, or the apply link goes nowhere: Claude ends the run as "Not sent: posting closed", with a photo.
- **Easy Apply on a board** (LinkedIn, Indeed): it works the same way. Photos are taken of the board's form.
- **The application is in a frame** (Greenhouse or Jobvite embedded in a company site): the photo still shows it, and Job Catcher fills inside the frame as today.
- **The tab isn't visible** when a photo is asked for: no photo ("The tab wasn't showing"). The run carries on.
- **Claude's chat runs out of turns or the user closes it**: the run stays open. A new chat with the same line carries on from the step it was on.
- **Self-identification questions** (gender, race, veteran, disability): Claude uses the user's saved answers. Otherwise it picks "I don't wish to answer" and marks the answer for review.
- **Essay questions**: Claude writes them from the master résumé and the job, marked "Claude wrote this" so the review shows them.
- **No Claude?** The application page explains it needs Claude in Chrome. Job Catcher's own Fill still works on any application.

## Requirements *(mandatory)*

- **FR-001** (A): Saved descriptions never contain expand/collapse button text. A Save press opens a description's "more" button before reading it.
- **FR-002** (A): Titles lose board-name and location tails. A board's name is never a company. A title equal to the company yields to a real title. Hiring-site addresses lose "careers-".
- **FR-003:** An application run belongs to one saved job and moves through: waiting for Claude → reading the job → questions → writing the résumé → filling → needs you → your review → submitting → sent | not sent | stopped. A user has at most one open run.
- **FR-004:** The connector gives Claude:
  - the apply brief: steps, locked rules, the job, the master résumé, the things the user told Claude, and the listing's skills the résumé doesn't show;
  - tools to ask questions, save the résumé, ask Job Catcher to fill a page, mark a page done (photos), ask for help, mark the application ready for review, wait for the user, record what the user said in a chat, and finish.
- **FR-005:** Answers are kept as things the user told Claude and are part of the master profile. They can be edited and deleted.
- **FR-006:** A saved résumé must have a name heading and at least two sections. It is saved as a document on the job and as the job's PDF résumé. Editing the document remakes the PDF.
- **FR-007:** One master résumé per user, picked in Settings › Résumés. The master profile uses it, else the usual résumé. Résumés made for a job can be deleted. Jobs using a deleted résumé go back to the usual one.
- **FR-008:** Job Catcher, only while a run is open: takes the photos, fills on request, uploads the job's résumé, and blocks Submit-type presses on the run's application site until the user's OK. It notices a Submit after the OK.
- **FR-009:** Photos: JPEG, at most 8 per page and 400 KB each, readable only by their owner, deleted 30 days after the run ends.
- **FR-010:** The application page works on phone and computer. The top banner shows on every app screen when a run needs the user.
- **FR-011:** Claude never submits without the user's OK through the app or the chat. The app never stores site passwords. Claude never makes up experience.
- **FR-012:** A run with no activity for 3 hours is stopped.

## Success Criteria *(mandatory)*

- **SC-001:** The owner applies to a real job from Apply with Claude to Sent, without typing into the application themselves except to sign in.
- **SC-002:** Every page of that application has photos the owner can read on the phone.
- **SC-003:** No new "… more" endings or board-named titles or companies in saved jobs after part A ships (checked on the live data a week later).
- **SC-004:** All existing tests still pass. New tests cover each run step, each connector tool, the photo and fill requests, the Submit block and the extraction fixes.

## Assumptions

- The user has Claude in Chrome on the computer and the Job Enhancer connector connected (the same setup as Scout).
- Claude in Chrome can't use Chrome's own password suggestions, so sign-ups go through "Claude needs you".
- The PDF layout is the one the app's PDF maker already uses (`# Name`, contact line, `## SECTIONS`, job lines with dates).
