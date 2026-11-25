# Feature Specification: Apply from the app

**Feature Branch**: `023-apply-from-the-app`

**Created**: 2026-11-25

**Status**: Draft

**Input**: The owner, after the first real runs of Apply with Claude (spec 022), 2026-11-25:
> "When the Claude extension tries applying it gets stuck on some screens. I really need our app to show me … the CAPTCHA or agreeing etc., all the random stuff, and being able to reply on the app for what Claude is needing and showing."
>
> "The Claude extension stops sometimes randomly. I got one application through, the other not yet. I wanna be able to just paste [the line] in, then go to the app and do it from there … and be confident it did!"
>
> "If someone wants to use Claude, someone uses Grok, or whatever model … they just connect the MCP."

**What the first real runs showed** (the live run log, 2026-11-25, read only):
1. **Job Catcher never answered.** All three requests (fill, photo) ended "no answer": the owner's Job Catcher was still 0.39 ("Update available (0.40.0)"). So Claude asked the owner to download and upload the résumé themselves, and no page had a photo. The app never said Job Catcher was out of date.
2. **Claude's questions had no answer box.** Claude asked about compensation expectations (with the posted range), "Can CFS reach out by SMS? Yes or No", and the current job title. The app only offered "Done, keep going", so the answer had to be typed into the Claude chat on the computer.
3. **A reCAPTCHA** opened in a new tab during a redirect. Only the person at the computer can solve it.
4. **After "Submit", nobody knew if it went.** The run sat at "Claude is pressing Submit" for a minute, and the owner pressed Stop. The app had no way to tell whether the application was sent.
5. **Claude in Chrome stops at random.** Each check for the owner's answer is one more step for Claude, and the waits are about 25 s, so a few minutes of waiting costs many steps.
6. **"&amp;" in 68 saved jobs** ("Microsoft 365 &amp; Copilot Administrator"), and the Job Catcher panel calls the app's own page an "Application in progress".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answer Claude in the app (Priority: P1)

When Claude needs the user, the application page shows:
- what Claude needs, in its words;
- **a photo of what's on the screen right now**;
- up to four quick answers Claude offers (for example "Yes" / "No", "$120,000", "I'll do it myself");
- a box to type any other answer.

"Send to Claude" sends the answer; Claude gets it at once and carries on. For something only the user can do at the computer (a CAPTCHA, a sign-in), the card says so plainly and offers "Done, keep going".

**Acceptance Scenarios**:
1. **Given** Claude asks "Can CFS reach out by SMS? Yes or No", **When** the user taps "No" on the phone, **Then** Claude's next check returns "No" and it fills that.
2. **Given** Claude asks for an expected salary, **When** the user types "$120,000" and sends it, **Then** Claude gets the words exactly.
3. **Given** a CAPTCHA, **When** the card shows, **Then** it says "This one needs you at the computer" and shows the photo of the screen.

### User Story 2 - Talk to Claude any time (Priority: P1)

The application page has a conversation:
- **Claude's short updates** ("Page 2 of 4: experience filled", "The site wants a phone number with the country code; I used +1").
- **What the user wrote**, with a "Message Claude" box. Example: "Use my Gmail address for this one", "Stop at the review, I'll check tonight".

Claude sees every new message on its very next connector call, whatever it's doing, and answers in the conversation.

**Acceptance Scenarios**:
1. **Given** a run that's filling, **When** the user sends a message, **Then** the next tool result Claude gets includes it, and it shows as "Read by Claude".
2. **Given** Claude posts an update, **When** the page polls, **Then** it shows in the conversation within about 5 seconds.

### User Story 3 - See the screen now (Priority: P1)

A "Show me the screen" button asks Job Catcher for a photo of the application's tab as it is now (one screen). It shows within seconds with its time. One is also taken by itself whenever Claude asks for help.

**Acceptance Scenarios**:
1. **Given** Job Catcher 0.41 on the computer with the application's tab showing, **When** the user taps Show me the screen on the phone, **Then** a photo of the tab shows within about 10 seconds.
2. **Given** the tab isn't showing, **When** it's asked, **Then** the app says "The application's tab isn't showing on the computer".

### User Story 4 - Know when Claude stopped, and keep it going (Priority: P1)

- **Claude waits longer.** It now waits up to about 50 seconds per check instead of 25, so the same wait costs half the steps. It's told to keep checking for up to 30 minutes.
- **The app notices when Claude stops.** If Claude hasn't called the connector for 3 minutes while it's Claude's turn, the page says "Claude seems to have stopped". It shows the line to say in Claude on the computer, "Carry on with my application", and a Copy button. A new chat carries on from the same step (spec 022).

**Acceptance Scenarios**:
1. **Given** status "filling" and no Claude call for 3 minutes, **When** the page loads, **Then** it shows the stopped notice and the carry-on line.
2. **Given** the user is answering a question (it's the user's turn), **When** 3 minutes pass, **Then** no stopped notice shows.

### User Story 5 - Be sure it was sent (Priority: P1)

After Submit is pressed in the application's tab (by Claude or by the user):
1. Job Catcher looks at the page for the next 20 seconds.
2. When it shows a confirmation ("Thank you for applying", "Application submitted", "We've received your application"…), Job Catcher sends a photo of it and the words.
3. The run ends as **Sent, confirmed**, with "Job Catcher saw: 'Thank you for applying'".

When no confirmation is seen, the page shows the last photo and asks "Did it go through?", with "It was sent" and "It wasn't". "It was sent" ends the run as Sent; "It wasn't" goes back to the review. The question also shows if the run has been "Claude is pressing Submit" for over 2 minutes.

**Acceptance Scenarios**:
1. **Given** Claude pressed Submit and the page shows "Thank you for applying", **When** Job Catcher reads it, **Then** the run is Sent with that proof, even if Claude's chat stopped.
2. **Given** no confirmation within 20 seconds, **When** the page shows, **Then** it asks "Did it go through?" with the photo.

### User Story 6 - Know Job Catcher is ready (Priority: P2)

The application page shows whether Job Catcher is ready on the computer: its version, and whether it was seen in the last hour. When it's out of date (older than 0.41.0) or not seen, it says so first, with the steps to update. That's what made the first runs fail. A request that got no answer says the same.

### User Story 7 - Any AI with the connector (Priority: P2)

The Start step still recommends Claude in Chrome. It also says "Using another AI that can browse and use connectors? Connect it to {connector address} and say the same line." Nothing in the steps or the rules needs Claude by name.

### User Story 8 - Small fixes (Priority: P2)

- Job titles, companies and places never show "&amp;", "&#39;" and the like. The 68 saved ones are fixed, and new ones are cleaned when saved (any source).
- The Job Catcher panel never calls the app's own pages an application.
- The browser tab's title starts with "(!)" while Claude needs you.

### Edge Cases

- **Messages while Claude is stopped:** they wait; a new chat gets them in the brief.
- **A reply to a question Claude stopped asking** (it moved on): it's delivered as a message.
- **The confirmation is in a new tab or a frame:** Job Catcher reads the application's tab and its frames. A new tab isn't read, so the app asks "Did it go through?".
- **Too many photos:** "screen now" photos keep only the newest 5 per run.

## Requirements *(mandatory)*

- **FR-001:** `need_help` takes up to 4 quick answers. The user's answer (a quick answer or typed text, up to 1000 characters) comes back to Claude from `wait_for_you`.
- **FR-002:** The run keeps a conversation (at most 200 messages, each up to 1000 characters). Claude posts with `message_user`. Every tool result includes the user's unread messages, which are then marked read. `wait_for_you` returns as soon as a new message arrives.
- **FR-003:** A "screen now" request (one screen, no scrolling) from the app or `need_help`. The newest 5 are kept.
- **FR-004:** Tool waits are up to 50 s. The run records Claude's last call; "stopped" is shown after 3 minutes with no call while it's Claude's turn.
- **FR-005:** Job Catcher reports a confirmation (its words and a photo) after a Submit in the run's tab. The server ends a run as sent on a confirmation only while it's submitting, or at the review with submit/self. The user can end a submitting run as sent or not sent.
- **FR-006:** The page shows Job Catcher's newest version and last seen time, and warns when it's older than 0.41.0 or unseen for over an hour.
- **FR-007:** Titles, companies and places are HTML-unescaped on every save; the stored ones are fixed by a migration.
- **FR-008:** No change to the safety rules: no Submit without the user's OK, no passwords, Submit locked by Job Catcher.

## Success Criteria *(mandatory)*

- **SC-001:** The owner runs an application from the phone after pasting one line, answering Claude's questions in the app.
- **SC-002:** A sent application shows "Sent, confirmed" with a confirmation photo, or asks the owner.
- **SC-003:** All existing tests pass. New tests cover replies, messages, screen-now, the stopped notice, confirmation, the Job Catcher readiness check, and unescaping.
