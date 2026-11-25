# Feature Specification: Apply with best judgment

**Feature Branch**: `026-apply-best-judgment`

**Created**: 2026-11-25

**Status**: Built (2026-11-25): PR A server + app, PR B Job Catcher 0.42.0

**Input**: The owner, after the first real Apply with Claude runs (spec 022/023):
> "why can't it attach a file?? should have my résumé it made for this job!??"
>
> "start populating what it's typing in, what boxes it's finding … is it easy and token efficient to do that while it's waiting and filling out?"
>
> "I think we should have Claude use its best judgment, and at the end is when it shows me all the fields … then I can chat with it and help it fix it, but in easy bubbles … have it use best judgment, I review and edit, then it fixes again."

**What the live data showed** (run 2fcfe2a7, AtkinsRéalis on Workday, read only):
- Job Catcher filled every page it was asked to: name, address and phone, then all three jobs on "My Experience".
- The résumé box at the top of "My Experience" was never attached, and never listed as something left for the user. Workday hides its file box behind a "Select files" button inside a drop zone whose name Job Catcher doesn't know, so the box was never seen at all.
- Every photo and "see the screen" request failed with "not visible": the application's tab wasn't the tab showing in its window (Claude in Chrome works in its own tab while the user looks at another, or the window is minimised).
- Claude stopped to ask about Prefix, Suffix and "How did you hear about us?", which are easy guesses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The job's résumé is attached, every time (Priority: P1)

During Apply with Claude, Job Catcher attaches **this run's résumé** (the one Claude made, or the one the user picked) to the application's résumé box, on every site, Workday included.
- It never guesses which saved job the page belongs to: the run says which résumé.
- A résumé box hidden behind a "Select files" or "Upload" button counts as a box.
- If it can't attach it, it says so plainly (Story 3). It never skips without a word.

**Acceptance:**
1. On a Workday "My Experience" page, `fill_page` attaches the run's résumé, and the result says `resume: attached`.
2. A job saved from LinkedIn and applied to on Workday still gets its own résumé.
3. A page with a cover-letter box and no résumé box gets nothing attached.

### User Story 2 - Photos work while Claude's tab isn't showing (Priority: P1)

Photos of each page, and "see the screen now", work when the application tab isn't the one showing.
- Job Catcher briefly shows the application tab in its window, takes the photos, and puts back the tab that was showing. It never photographs another tab.
- A minimised window is restored for the photos and minimised again.
- If Chrome can't take a picture at all (the screen is locked, or the window is hidden behind other apps while the user is working), the page's questions and answers are still saved as text, and the app says why there's no photo in plain words.

**Acceptance:**
1. With the user on another tab in the same window, `page_done` returns photos, and the user's tab is showing again afterwards.
2. With the screen locked, the result says "no photo: the computer is locked", and the page's answers are kept.

### User Story 3 - Say plainly what couldn't be done (Priority: P1)

Whatever Job Catcher or Claude couldn't do is shown in plain words, with what to do about it:
- The résumé: attached / no résumé box on this page / couldn't attach (with **Download your résumé for this job** and **Try again**).
- Photos: taken / why not.
- Boxes left empty.

Claude gets the same facts in the tool result, so it never asks the user to attach a file Job Catcher already attached.

**Acceptance:**
1. When attaching fails, Claude's "Claude needs you" card shows the reason, a Download button for the run's résumé, and Try again.
2. A photo failure shows one plain line on the page row, not a broken image.

### User Story 4 - Watch the boxes fill, live (Priority: P1)

While an application is being filled, the application page shows **Filling now**: every box on the page Claude is on, and what's in it, updating every few seconds, on the phone or computer.
- Job Catcher's answers are marked "Job Catcher". Boxes Claude fills appear as Claude types them.
- It costs no Claude tokens: Job Catcher reads the page and sends it to the app. Claude isn't asked anything.
- Never passwords or card numbers; values are capped in length.

**Acceptance:**
1. During a fill, the app lists the page's boxes and their values within ~5 s of them changing, without reloading.
2. When the run stops filling (review, sent, stopped), Filling now goes away.

### User Story 5 - Best judgment: fill everything, stop only when it must (Priority: P1)

Claude fills every box using its best judgment and **only stops** for:
- signing in or making an account (passwords are the user's);
- a CAPTCHA or "I'm not a robot";
- a file Job Catcher couldn't attach;
- **facts about the user it can't know**: experience, years with a tool, degrees, licences, certifications, work authorisation, sponsorship, clearance. **Experience is never guessed.**

Everything else, Claude decides and **marks as a guess**:
- easy picks (Prefix, "How did you hear about us?", preferred contact);
- self-ID (the saved answer, else "I don't wish to answer");
- pay (the user's saved number, else the posting's range);
- start date, notice period, relocation, "OK to text?".

Agreements a page requires to go on (privacy notice, "I certify this is true") are ticked and **listed for the user's OK at the review**. Nothing is ever sent without the user pressing Submit. Optional ones (marketing, texts) are left unticked.

**Acceptance:**
1. "How did you hear about us?" is answered (e.g. "LinkedIn", the job's source) and marked as a guess, with no stop.
2. "Years of Python experience?" when the profile doesn't say stops with `need_help`.
3. A required "I agree" is ticked and appears at the review under "You're agreeing to".

### User Story 6 - Review in bubbles, fix in one go (Priority: P1)

At the review, every answer on every page is a **bubble**: question, answer, and where it came from (your profile, Job Catcher, Claude wrote it, **Claude guessed**). Guesses and agreements come first.
- Tap a bubble: **Change it to…** (type or pick) or **Ask Claude** ("is this right?").
- Changes pile up in a tray: "3 fixes". **Send fixes** sends them all to Claude at once.
- Claude makes the changes, answers the questions (in the conversation), updates the photos, and the review shows again with the new answers.

**Acceptance:**
1. Changing two answers and asking one question sends one fix to Claude with all three.
2. After Claude's fixes, the review shows the new answers and photos, and the guesses Claude fixed aren't marked as guesses any more.

### Edge Cases

- **The application tab is closed mid-run:** photos and the live view say "the application's tab is closed", and Claude is told.
- **Two computers:** only the one with the application's tab does the work (as today).
- **A very long page** (over 150 boxes): the live view shows the first 150.
- **An old Job Catcher** (before 0.42.0): everything still works as before, minus the live view, the run's own résumé and the new photo fix; the app says "Update Job Catcher" (as it does today).
- **The user changes something on the page by hand:** the live view shows it; at the review the bubble shows the page's value.

## Requirements *(mandatory)*

- **FR-001:** Job Catcher uses the open run's résumé for any page of that run (no URL guessing).
- **FR-002:** A file input hidden behind a visible upload button or drop zone is seen as an upload box; Workday's résumé box is recognised as the résumé's.
- **FR-003:** The fill result reports the résumé (`attached`, `no_box`, `no_file`, `failed`) and any boxes left.
- **FR-004:** Photos bring the run's tab to the front of its window (and restore a minimised window), then put back exactly what was showing; failures carry a plain reason (`tab_closed`, `locked`, `hidden`, `changed`).
- **FR-005:** Job Catcher sends the run tab's boxes and values to the app while the run is filling, at most every 3 s and only when they change; never sensitive boxes; capped in count and length.
- **FR-006:** The app shows Filling now during filling, the problems in plain words, and a Download for the run's résumé on file problems.
- **FR-007:** The playbook (and its locked rules) changes to best judgment: stop only for sign-in, CAPTCHA, files and facts about the user; guesses marked `guess: true`; required agreements marked `agreement: true`.
- **FR-008:** The review shows answer bubbles with their source, edits and questions batched into one fix (`fixes`) that Claude receives in `wait_for_you`.
- **FR-009:** No AI in the app. No new connector tools: existing tools gain optional fields.
- **FR-010:** Security: owner-only routes, values trimmed, password/SSN/card boxes never sent or stored, live data deleted when the run ends.

## Success Criteria *(mandatory)*

- **SC-001:** On the owner's next Workday application, the résumé made for the job is attached without the owner touching the computer.
- **SC-002:** Every page of the next run has photos, or a plain reason why not.
- **SC-003:** A typical application stops for the user at most for sign-in, CAPTCHA and true experience questions; easy questions are guessed and reviewed in bubbles.
- **SC-004:** The owner fixes 2+ answers from the phone in one Send, and sees them fixed in the next review.
- **SC-005:** All existing tests pass; new tests cover each story.

## Assumptions

- Claude in Chrome keeps working in a tab of the user's normal Chrome window (as seen live).
- "Bring to front" is acceptable during an Apply with Claude run: the user started it and usually follows on the phone. It lasts about a second per page and puts the user's tab back.
- Item 6 of the owner's list (pick a résumé before starting) is in spec 025, since it's about résumés.
