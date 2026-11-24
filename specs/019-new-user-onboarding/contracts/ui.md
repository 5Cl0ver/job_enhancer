# UI contracts: 019

Plain words everywhere. Every screen works at phone width (360px) and on a computer. Copy below is the intended wording; small edits are fine, but no jargon.

## Web app

### Welcome (`/welcome`, full-page, opened automatically when `welcome.done` is false)

A row of dots (1 of 4) sits at the top. **Skip, do it later** is in the top corner on every step, and **Back** appears on steps 2–4.

**0. Hello** (no dot)
- "Welcome to Job Enhancer. Find jobs, keep them in one place, and fill applications in seconds."
- Three icons with one line each: Find · Track · Fill.
- Button: **Let's set you up (about 3 minutes)**.

**1. Your résumé**
- Drop zone or **Choose file** (PDF or Word).
- While reading: "Reading your résumé with the free AI…", shown with a progress shimmer.
- When done: the profile review form appears (name, email, phone, city, links, work history, education), every field editable. Button: **Looks right**, which sets `profile_reviewed`.
- If it fails or the allowance is used up: "We saved your résumé but couldn't read it right now. Fill these in by hand, or try again later." The empty form is still shown.
- ⓘ "What's the free AI?": "It reads your résumé and writes cover letters for you. It's included; nothing to set up. Everyone gets a daily amount."

**2. Get Job Catcher**
- "Job Catcher sits in Chrome on your computer. It saves jobs from any site and fills job applications for you."
- On a computer: **Get Job Catcher**, which opens `/job-catcher` in a new tab, plus "I'll do it later".
- On a phone: "Job Catcher runs in Chrome on a computer.", with **Share link** and **Copy link** to open it later.
- A live tick ("Connected ✓") appears when Job Catcher signs in while this step is open (the step polls `/onboarding` every 5 seconds).

**3. Optional extras** (badge "Optional"). Two cards, each with **Set up** and **Not now**:
- **Email updates**: "If job emails (interviews, rejections) come to one inbox, Job Enhancer can move your jobs along for you. Needs an app password; we show you how." Set up opens `/settings#email`.
- **Claude**: "Have a Claude account? Connect it for Claude Scout (Claude searches job sites for you) and Claude-written documents. Not needed: the free AI covers the basics." Set up opens `/settings#claude`, where the connector address and steps now appear.

**4. Done**
- "You're ready." Two big buttons: **Find jobs** (`/search`) and **My jobs** (`/jobs`).
- Line: "Your Getting started list keeps track of what's left."

### Getting started card

- **Where**: top of `/search` and `/jobs` (computer and phone). It is hidden when `checklist_hidden` is set or all required items are done.
- **Shows**: the title "Getting started", a progress bar "2 of 4 done", and the next undone item highlighted with its button.
- **Items**, each with a ✓ or a link:
  - Add your résumé → `/welcome?step=1`
  - Check your profile → `/autofill#profile`
  - Get Job Catcher → `/job-catcher`
  - Save your first job → `/search`
  - Email updates (Optional) → `/settings#email`
  - Claude (Optional) → `/settings#claude`
- The ⋯ menu has: **I'm all set** (hide) and **Open the welcome again**.
- **Settings → Appearance** gets a **Show Getting started** switch.

### Get Job Catcher (`/job-catcher`, nav item "Job Catcher", icon Puzzle)

- Header: "Job Catcher", with "Version 0.35.0 · what's new" (notes from `/extension/latest`).
- **Download Job Catcher (.zip)** button, linking to the release URL.
- A status chip:
  - "Not installed yet";
  - "Connected ✓ (0.35.0)";
  - "Update available: you have 0.34.1", which links to the update steps.
- **Install in 6 steps**: numbered cards, each with an illustration and one sentence.
  1. Unzip the download into a folder you'll keep (for example, Documents › Job Catcher).
  2. In Chrome, go to `chrome://extensions` (Copy button).
  3. Turn on **Developer mode** (top right).
  4. Press **Load unpacked** and choose the folder.
  5. Pin it: puzzle icon › pin next to Job Catcher.
  6. Click Job Catcher, then **Connect to Job Enhancer**.
- **About the "developer mode" message** (a collapsible): "Chrome shows this for extensions that aren't in the Chrome Web Store yet. Job Catcher only talks to Job Enhancer. You can remove it any time from chrome://extensions."
- **Updating**: "Download the new zip, unzip it over the same folder (replace the files), then press ↻ on Job Catcher in chrome://extensions."
- **Works in**: Chrome, Edge, Brave (computer). Not on phones.
- **Phone view**: the steps are replaced by the share/copy card (as in Welcome step 2).

### Connect approval (`/connect?code=…`)

- Signed out: goes to Login with `?redirect=/connect?code=…`.
- Shows: "Connect Job Catcher on this computer to **{account email}**?", the code in large letters ("Check it matches the code in Job Catcher"), and **Connect** / **Cancel**.
- "Not you? Sign out and use another account."
- After **Connect**: "Connected. You can close this tab and go back to Job Catcher."
- Expired or used: "This link has expired. Press Connect in Job Catcher again."

### Sign-in

- **Login** gets a **Forgot password?** link, which opens `/forgot-password`: an email field and **Send reset link**, then the neutral message.
- `/reset-password` (reached from the email link): new password twice, **Save**, then go to `/`.
- After sign-in, Login goes to the safe `redirect`.

### ⓘ bubbles

- A 16px ⓘ button with `aria-label="About {feature}"`.
- The bubble is at most 280px wide and holds:
  - bold **What it is**;
  - **Why it helps**;
  - **Needs** (only if any);
  - "Learn more →" (only if any).
- The text lives in `frontend/src/lib/help.ts`.
- **Placed at**: the page titles of Matches, Email updates, AI Apply, Autofill memory, Analytics and Job Catcher; the Claude Scout tab; the pipeline stages header; and the Settings sections Claude, Email and Export.

### Allowance labels

- Under AI buttons: "8 of 10 free AI documents left today ⓘ".
- On the over-limit 429: an inline alert with the message, the reset time in the person's local time, and the alternatives (e.g. "Use My Claude instead" in Job Catcher's Write view).

### Admin

- **User table** gets columns for setup (six small ticks with tooltips), Job Catcher version (amber if outdated), last active, and AI today.
- A new **Allowances** card has number inputs and **Save**.

## Job Catcher panel

- **Signed out**: the main button is **Connect to Job Enhancer**. Below it, "or sign in with a password" expands the old form.
- **While connecting**:
  - "Approve in the Job Enhancer tab. Code **K7QM-3XPD**";
  - a spinner;
  - **Cancel** and **Open the tab again**.
  - After 5 minutes: "That took too long. Try again."
- **Signed in**:
  - Settings shows the version.
  - If it's older than the latest, a top banner reads "Update available (0.35.0)" with **How to update**, which opens `/job-catcher#update`.
- **ⓘ bubbles** on Super autofill, Point at a box, and Write for this job (free AI vs My Claude).
