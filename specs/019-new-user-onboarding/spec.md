# Feature Specification: New-user onboarding and Job Catcher download

**Feature Branch**: `019-new-user-onboarding`

**Created**: 2026-11-23

**Status**: Draft

**Input**: The owner wants friends to start using the app for free:
- "Let's do the download link for now, the store one later when it's really good."
- "Really think about the pipeline of users getting into the app, because I use Yahoo, I set it up, I use Claude etc. Some people may not!"
- "We have a default AI they can use, right, our NVIDIA key?"
- "Really think about onboarding new users when they arrive. Make it super easy for them to understand, read things, guide them, a little i bubble for them or something fancy."

**What exists today** (survey of the code, 2026-11-23):
- **Sign-up** is open: email and password, or GitHub.
  - A first sign-in only creates the default pipeline stages and a "Saved" folder.
  - There is no welcome, tour, checklist or help page.
  - Sign-in forgets where the person was going.
  - There is no "forgot password".
- **Job Catcher** can only be installed by building it from the code.
  - There is no download and no install guide.
  - Its panel signs in with email and password only, so anyone who signed up with GitHub can't use it.
- **AI:**
  - The free AI (the server's NVIDIA key) works for everyone with no setup. It writes résumés and cover letters, reads a résumé into the profile, and helps Autofill.
  - Claude is optional and only for people who have it. The connector address is written only in a developer document.
- **Email updates** work with any provider through an app password, with guides in Settings.
- **Live job searches** spend a shared monthly allowance of 200 for all users together. There are no per-person limits on the free AI or on live searches.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A welcome that sets a newcomer up in minutes (Priority: P1)

A friend signs up and lands on a short **Welcome**, not an empty app. It explains in plain words what Job Enhancer does: find jobs, keep them in one place, and fill applications fast. Then it walks them through a few steps, one per screen, with a progress dot row and a "Skip, do it later" on each:

1. **Your résumé.** Upload it. The free AI reads it and fills the application profile (name, contact, work history, education). The person checks it and fixes anything wrong.
2. **Get Job Catcher.** Explains what it is in one sentence: "fills job applications for you and saves jobs from any site". Links to the install guide (User Story 3).
3. **Optional extras, for those who want them.** Each extra is a card that says who it's for and what it needs. Each can be set up now or later:
   - **Email updates** ("for anyone whose job emails come to one inbox; needs an app password, we'll show you how").
   - **Claude** ("for people with a Claude account; adds Claude Scout and Claude-written documents; the free AI already covers the basics").
4. **Done.** "You're ready. Here's where to start": find jobs, or save one from any site.

The Welcome never blocks the app. Closing it at any step keeps progress, and it can be reopened from the Getting started checklist (User Story 2) or Settings.

**Why this priority**: today a newcomer lands on an empty search page with no idea what to do or what the app needs from them. This is the front door.

**Independent Test**: Sign up a brand-new account. The Welcome appears. Upload a sample résumé and the profile is filled. Skip the rest, and the app opens with nothing broken. Sign out and back in: the Welcome does not reappear, but it can be reopened.

**Acceptance Scenarios**:

1. **Given** a brand-new account, **When** it signs in for the first time on phone or computer, **Then** the Welcome opens on its first step.
2. **Given** the résumé step, **When** the person uploads a résumé, **Then** the profile is filled by the free AI within about a minute and shown for review, with every field editable.
3. **Given** the free AI is unavailable or the person is over today's limit, **When** they upload a résumé, **Then** the résumé is still saved, a plain message explains, and they can fill the profile by hand or try later.
4. **Given** any step, **When** the person presses "Skip, do it later" or closes the Welcome, **Then** they land in the app and the skipped items stay on the checklist.
5. **Given** an existing user (anyone who signed up before this feature), **When** they sign in, **Then** the Welcome is not forced on them; the checklist offers it once.

---

### User Story 2 - A "Getting started" checklist that keeps them going (Priority: P1)

A small **Getting started** card shows what's done and what's next, with a progress bar ("3 of 5"). On a computer it sits at the top of the main page; on a phone it shows on the jobs screen. Items:
- Add your résumé.
- Check your profile.
- Get Job Catcher.
- Save your first job.
- Optional (marked as such): email updates, Claude.

Each item opens the exact place to do it. Items tick themselves when the thing is actually done (for example, "Get Job Catcher" ticks when Job Catcher signs in to this account), not when a button is pressed. The card can be hidden ("I'm all set"). It disappears once the required items are done, and can be brought back from Settings.

**Why this priority**: people leave a Welcome halfway. The checklist is how they finish, at their own pace, without anyone chasing them.

**Independent Test**: With a new account that skipped everything, the card shows 0 of 4 required. Upload a résumé, connect Job Catcher and save a job; each ticks on its own. Hide the card, and it stays hidden on the next visit and on another device.

**Acceptance Scenarios**:

1. **Given** items not done, **When** the person opens the app, **Then** the card shows progress and the next item first.
2. **Given** Job Catcher signs in to this account on any computer, **When** the card refreshes, **Then** "Get Job Catcher" is ticked.
3. **Given** the person hides the card, **When** they come back on any device, **Then** it stays hidden until they turn it back on in Settings.
4. **Given** an optional item, **Then** it never counts against "done" and is labelled "Optional".

---

### User Story 3 - Get Job Catcher: download and install in a few minutes (Priority: P1)

A **Get Job Catcher** page in the app (in the menu, and linked from the Welcome and the checklist) offers:
- **A download button** for a ready-to-load file. It is already set to talk to the live app, so the person never edits anything.
- **The latest version number** and what changed.
- **A visual step-by-step guide**, one short step at a time, each with a picture:
  - unzip the download into a folder you'll keep;
  - open chrome://extensions;
  - turn on Developer mode;
  - press Load unpacked and pick the folder;
  - pin Job Catcher;
  - open the side panel and connect it to your account (User Story 4).
- **A note on the Chrome warning**: why Chrome mentions "developer mode" extensions, and that it's expected for apps not yet in the Chrome Web Store.
- **Which browsers work**: Chrome, plus other Chromium browsers (Edge, Brave). It says plainly that phones can't run browser extensions, so on a phone the page explains Job Catcher is for the computer and offers to share or copy the link (for example to their own email) to open later on a computer.

The download is rebuilt automatically every time a new Job Catcher version is released on the main line, so it is never stale and never points at a test server.

When Job Catcher is connected and older than the latest version, the app shows a small "Job Catcher update available" note with the update steps: download, replace the folder, press reload. Job Catcher's own panel shows the same note.

**Why this priority**: Job Catcher is the best part of the app, and today nobody but the owner can install it.

**Independent Test**: On a clean Chrome profile, download from the page and follow only the on-screen steps. Job Catcher loads, opens its panel and talks to the live app with no edits. Then install an older copy: the app and the panel both say an update is available.

**Acceptance Scenarios**:

1. **Given** the Get Job Catcher page, **When** the person downloads and follows the steps, **Then** Job Catcher loads without errors and its panel opens.
2. **Given** a new Job Catcher version is merged into the main line, **When** the release finishes, **Then** the page offers that version within the same day, and the file points at the live app only.
3. **Given** a connected Job Catcher older than the latest, **Then** the app and the panel both show "Update available" with the steps.
4. **Given** the page is opened on a phone, **Then** it explains Job Catcher is for a computer's Chrome and offers to share or copy the link for later.

---

### User Story 4 - Job Catcher connects with one press, for everyone (Priority: P1)

Job Catcher's panel shows **Connect to Job Enhancer**. Pressing it opens the app, where the person, already signed in, presses **Connect** once. The panel is then signed in, with no password typed, so people who signed up with GitHub can use it. The existing email-and-password sign-in stays as a second choice.

The app also gains **Forgot password?** on the sign-in screen, and sign-in returns people to where they were going (for example, the Claude connector approval page).

**Why this priority**: without it, everyone who signed up with GitHub is locked out of Job Catcher.

**Independent Test**: With a GitHub-only account, install Job Catcher, press Connect, approve in the app. The panel shows the account and can save a job.

**Acceptance Scenarios**:

1. **Given** the panel is signed out, **When** the person presses Connect and approves in the app, **Then** the panel is signed in within a few seconds, for any kind of account.
2. **Given** the person is signed out of the app, **When** they press Connect, **Then** the app asks them to sign in, then returns to the approval.
3. **Given** the approval page, **Then** it says plainly what is being connected ("Job Catcher on this computer") and offers Cancel.
4. **Given** "Forgot password?", **When** the person enters their email, **Then** they get a reset link, and the page says so without revealing whether the email has an account.
5. **Given** a sign-in started from a link to a specific page, **When** sign-in succeeds, **Then** the person lands on that page.

---

### User Story 5 - Little "i" bubbles that explain things where they are (Priority: P2)

Next to features and settings that a newcomer might not understand, a small **ⓘ** opens a short bubble:
- **What it is.**
- **Why it helps.**
- **What it needs**, if anything (for example "needs Job Catcher", "needs a Claude account", "uses the free AI: 20 a day").
- A "Learn more" link where a fuller guide exists.

On a computer it opens on hover or click; on a phone, on tap. It closes on tap outside or Esc. Bubbles cover at least:
- Matches, Email updates, AI Apply, Autofill memory, Claude Scout, Analytics, pipeline stages;
- in Settings: Claude project, email connection, data export;
- in Job Catcher's panel: Super autofill, Point at a box, Write for this job.

**Why this priority**: it makes the app explain itself everywhere, but it builds on the core path above.

**Independent Test**: On a phone and a computer, open each listed ⓘ. Each shows the three parts in plain words, never covers the thing it explains so badly it can't be used, and can be closed.

**Acceptance Scenarios**:

1. **Given** an ⓘ on a computer, **When** hovered or clicked, **Then** the bubble opens beside it, and keyboard users can open it with Enter and close it with Esc.
2. **Given** an ⓘ on a phone, **When** tapped, **Then** the bubble opens, fits the screen, and closes on a tap outside.
3. **Given** any bubble, **Then** its text is three short parts with no jargon (no "IMAP", "MCP", "OAuth" without a plain explanation).

---

### User Story 6 - Fair use of the free services everyone shares (Priority: P2)

The free AI and live job searches are shared by everyone, so each person gets a daily allowance:
- **Free AI:** writing a résumé or cover letter, reading a résumé, and the AI help in Autofill.
- **Live searches:** fresh searches that spend the shared monthly allowance. Searching the jobs already in the app is never limited.

Where these are used, the app shows what's left today ("8 of 10 AI documents left today"). When someone runs out, a friendly message says when it resets, and what still works without it (for example, Autofill still fills everything it knows without AI; Claude users can use "My Claude"). The owner is never limited, and the admin page shows each person's use today and this month, plus the shared live-search allowance left this month.

**Why this priority**: one curious friend could use up the month's shared searches or the AI in a day and break it for everyone, the owner included.

**Independent Test**: With a normal account and a lowered allowance, use the free AI until it runs out. The friendly message appears, the count reads 0, and it works again the next day. The owner's account is never stopped. The admin page shows the numbers.

**Acceptance Scenarios**:

1. **Given** a person under their allowance, **When** they use the free AI, **Then** it works and the "left today" count drops by one.
2. **Given** a person at their allowance, **When** they try again, **Then** nothing is spent, and a plain message gives the reset time and what still works.
3. **Given** the shared monthly live-search allowance is nearly used up, **Then** live searches stop for everyone but the owner, searches of jobs already in the app still work, and the message says so.
4. **Given** the owner's account, **Then** no allowance ever blocks it.

---

### User Story 7 - The owner sees how friends are getting on (Priority: P3)

The admin page's user list shows, per person:
- when they joined and were last active;
- their setup progress (Welcome finished, résumé, profile checked, Job Catcher connected and its version, email updates, Claude);
- their free-service use.

The owner can see who is stuck and help them. "Last active" reflects real use of the app or Job Catcher, not just profile edits.

**Why this priority**: helpful for supporting friends, but not needed for anyone to get started.

**Independent Test**: Create two test accounts at different stages. The admin list shows each one's ticks, version and last activity correctly.

**Acceptance Scenarios**:

1. **Given** a user who connected Job Catcher yesterday, **Then** the admin list shows Job Catcher ✓ with its version, and last active yesterday.
2. **Given** a non-admin, **Then** they can never see the admin list.

### Edge Cases

- **Résumé the AI can't read** (a scanned image, an unusual format, a huge file): the file is kept, a plain message explains, and the profile can be filled by hand. Nothing half-filled is saved without review.
- **Two devices at once:** the Welcome is finished on a phone while the computer still shows it. The computer catches up on its next load, and progress is never lost or reset.
- **Old Job Catcher copies** still pointing at a test server: the panel says it can't reach Job Enhancer, and the Get Job Catcher page explains how to reinstall.
- **Connect pressed twice, or the approval tab closed:** nothing breaks. The panel says "Waiting for you to approve in the app" with Try again, and the attempt expires after a few minutes.
- **A different account is signed in to the app than the one the person meant:** the approval page shows which account Job Catcher will join, with a way to switch.
- **Phones:**
  - Job Catcher steps say plainly that they're for a computer.
  - Every other step (résumé, profile, email, Claude) works on a phone.
- **Free AI turned off on the server** (key missing or rejected):
  - steps that use it say so;
  - manual alternatives are offered;
  - the checklist still completes.
- **Allowance changes** after someone already used some: the new number applies from the next use, and nobody is cut off mid-task.
- **Account deleted:** the deletion also removes its onboarding progress and usage counts. Exports include them.
- **Existing users:**
  - The owner and anyone already set up never see the Welcome forced.
  - Their checklist ticks from what they already have.

## Requirements *(mandatory)*

### Functional Requirements

**Welcome and checklist**
- **FR-001**: On an account's first sign-in, the app MUST show a Welcome of at most five short steps: what the app does; résumé; Job Catcher; optional extras; done. Each step offers "Skip, do it later", and closing keeps progress.
- **FR-002**: The résumé step MUST save the uploaded résumé, have the free AI fill the application profile from it, and show the result for review and editing before it is treated as checked.
- **FR-003**: Optional extras (email updates, Claude) MUST be labelled optional, say who they're for and what they need in one or two sentences, and never be required to finish the Welcome or the checklist.
- **FR-004**: The app MUST keep each account's onboarding progress (Welcome finished or dismissed, checklist hidden) with the account, so it follows the person across devices.
- **FR-005**: The Getting started checklist MUST:
  - show progress;
  - tick items from real state: a résumé exists, the profile was reviewed, Job Catcher signed in, at least one saved job, email connected, Claude connected;
  - link each item to the exact place;
  - be hideable, and come back from Settings.
- **FR-006**: Accounts created before this feature MUST NOT be forced through the Welcome. Their checklist MUST reflect what they already have.

**Job Catcher download and updates**
- **FR-007**: The app MUST have a Get Job Catcher page with:
  - a download of a ready-to-load Job Catcher set to the live app;
  - the latest version and short release notes;
  - a picture-led install guide;
  - a plain note about Chrome's developer-mode warning;
  - which browsers work.
- **FR-008**: The downloadable Job Catcher MUST be produced automatically from the main line whenever its version changes. It MUST never contain test or local server addresses, and the release MUST fail rather than publish a file that does.
- **FR-009**: When a connected Job Catcher is older than the latest release, both the app and Job Catcher's panel MUST say an update is available, with the steps.
- **FR-010**: On a phone, the Get Job Catcher page MUST explain that Job Catcher runs on a computer's Chrome and offer to share or copy the link (the phone's own share menu, so it can go to their email or notes).

**Connecting Job Catcher and signing in**
- **FR-011**: Job Catcher MUST offer "Connect to Job Enhancer". It opens the app's approval page; one press there signs the panel in for any kind of account, with no password. The approval page MUST name the account and what is being connected, and offer Cancel.
- **FR-012**: A connect attempt MUST expire after a few minutes, work only once, and only ever sign in the panel that started it.
- **FR-013**: Password sign-in in Job Catcher MUST keep working.
- **FR-014**: The app MUST offer "Forgot password?" with an emailed reset link. The message MUST NOT reveal whether an email has an account.
- **FR-015**: Sign-in MUST return the person to the page they were sent from (including the Claude connector approval), and only to pages inside the app.

**Info bubbles**
- **FR-016**: The app and Job Catcher's panel MUST show ⓘ bubbles on at least the features listed in User Story 5. Each has what it is, why it helps, what it needs, and "Learn more" where one exists.
- **FR-017**: Bubbles MUST open on hover or click on a computer and on tap on a phone, MUST open and close by keyboard (Enter, Esc), MUST be announced to screen readers, and MUST fit on a phone screen.

**Fair use**
- **FR-018**: Each non-owner account MUST have daily allowances for:
  - free-AI documents (résumés and cover letters);
  - free-AI reading (résumé to profile, work history);
  - free-AI help during Autofill;
  - live job searches that spend the shared monthly allowance.
  
  Using the jobs already in the app MUST never be limited.
- **FR-019**: Where an allowance applies, the app MUST show what's left today. On running out it MUST spend nothing and show a friendly message with the reset time and what still works without it.
- **FR-020**: The shared monthly live-search allowance MUST be tracked. Live searches MUST stop for non-owners before it runs out, keeping a reserve for the owner.
- **FR-021**: The owner (admin) MUST never be limited, and MUST be able to change the allowance numbers without a code change.

**Owner view**
- **FR-022**: The admin user list MUST show each person's:
  - setup progress (Welcome, résumé, profile reviewed, Job Catcher connected and version, email, Claude);
  - real last activity;
  - free-service use today and this month.
  
  Only admins may see it.

**Throughout**
- **FR-023**: Every new screen MUST work equally on phone and computer and use plain words. Technical terms MUST come with a one-line explanation or not appear at all.
- **FR-024**: Onboarding progress and usage counts MUST be included in the person's data export and removed with their account.

### Key Entities

- **Onboarding progress (per account):**
  - when the Welcome was finished or dismissed;
  - the step reached;
  - whether the profile was reviewed;
  - whether the checklist is hidden.
  
  Most checklist ticks are worked out from real state, not stored.
- **Job Catcher connection (per account and computer):**
  - that a Job Catcher signed in;
  - its version;
  - when it was last seen.
  
  Used for the checklist tick, the update note and the owner view.
- **Connect request:** a short-lived, single-use approval that links one Job Catcher panel to the account that approved it.
- **Usage count (per account, per kind, per day):** how many free-AI uses or live searches were spent. Plus a shared monthly count for the live-search allowance.
- **Allowance settings:** the daily numbers per kind and the shared monthly reserve, changeable by the owner.
- **Job Catcher release:** version, release notes, download, date. The latest one is what the app offers and compares against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newcomer with only an email address and a résumé file can go from sign-up to a filled, reviewed profile in under 5 minutes, without help.
- **SC-002**: A newcomer on a computer can download, install and connect Job Catcher in under 5 minutes by following only the on-screen guide, with no file edits.
- **SC-003**: 100% of accounts, GitHub sign-ups included, can sign Job Catcher in.
- **SC-004**: Everything in the Welcome and checklist except the Job Catcher install can be completed on a phone.
- **SC-005**: No single non-owner account can use more than its daily allowance of the free AI or live searches, and the shared monthly live-search allowance is never used up by non-owners.
- **SC-006**: The offered Job Catcher download matches the newest released version within one day of each release, and never points anywhere but the live app.
- **SC-007**: In a hallway test with 3 people who've never seen the app, each can say in their own words what Job Catcher and the free AI do after the Welcome, and none gets stuck on an optional step.

## Assumptions

- **Sign-up stays open** to anyone (no invite codes for now). The owner can see and remove accounts, and fair-use allowances protect the shared services.
- **Starting daily allowances** (changeable by the owner):
  - 10 AI documents;
  - 5 résumé or work-history reads;
  - 100 Autofill AI helps;
  - 5 live searches per person.
  
  The live-search reserve kept for the owner is 40 of the shared 200 a month. The day resets at midnight US Pacific time.
- **Distribution:** Job Catcher is distributed only as a download for now. The Chrome Web Store is a later, separate feature. Phones can't run it.
- **AI:** paused for now (owner, 2026-11-24; research R13). The résumé step reads with the built-in reader and no AI; allowances count AI only when it runs. Later, the free AI is the server's existing NVIDIA key, with no setup for users. Claude stays optional and uses the person's own Claude account; nothing here adds a paid service.
- **Email updates** keep today's app-password method and guides. Gmail and Outlook one-click sign-in stay out of scope.
- **Pictures** for the install guide are made from a test Chrome profile with invented data, never real personal data.
- **The owner** is the account set as admin today.
