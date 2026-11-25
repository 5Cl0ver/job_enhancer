# Research: Apply from the app

## R1: Why Claude in Chrome "stops at random", and how long a tool may wait

- **Evidence (live run log, 2026-11-25):**
  - Run 1 waited 31 minutes at the review (07:30 → 08:02), with Claude calling `wait_for_you` about every 25 s.
  - After the owner's Submit, Claude marked "pressing Submit" and then went silent.
  - Each wait is a step in Claude's agent loop, and a long wait spends many steps.
- **Decision:**
  - Waits go up to **45 s**. MCP clients commonly time out a request at 60 s (the TypeScript SDK's default request timeout), so 45 s keeps a safe margin. That halves the steps per minute of waiting.
  - The playbook tells Claude to keep checking for up to 30 minutes, and to post a short update with `message_user` instead of stopping.
- **Rejected:** waits of several minutes. A connector call longer than the client's timeout fails, and Claude may give up.

## R2: Telling the app Claude stopped

- **Decision:**
  - A new `claude_at` time on the run, stamped on every connector call.
  - It's "Claude's turn" when:
    - the status is reading, writing, filling or submitting;
    - or the user has already answered (questions sent, help done, a review decision not yet read).
  - "Stopped" means Claude's turn with no call for 3 minutes. The page shows it with the carry-on line.
- **Rejected:**
  - Using `last_activity_at`: the user's own actions move it.
  - Pushing a notification to the phone: no push setup yet, and the page banner plus the tab title covers it.

## R3: Replies and messages

- **Decision:**
  - A `messages` JSON list on the run: `{id, by: "you"|"claude", text, at, read}`.
  - `need_help` takes `choices` (up to 4).
  - The app's reply is stored on `help.reply` and also as a message.
  - Every connector tool result gets `from_user` (unread messages, then marked read).
  - `wait_for_you` returns early on a new message, with `ready: false` and `from_user`, so Claude reads it and carries on waiting.

## R4: "Screen now" photos

- **Decision:**
  - A request of kind `peek`: Job Catcher photographs the tab as it is, with no scrolling. It's stored as page 0, keeping the newest 5.
  - Pending requests are only replaced by a newer one of the **same kind**. A peek never cancels a fill or a page photo.

## R5: Knowing it was sent

- **Decision:**
  - After a Submit press in the run's tab, Job Catcher reads the top page (and its frames) every 2 s for 20 s for confirmation words. Examples: "thank you for applying", "application (has been) submitted", "we've received your application", "application received", "successfully submitted", "thanks for your application".
  - On a match, it takes a photo (a peek) and sends the event `confirmation_seen {words}`.
  - The server ends the run as sent with "Job Catcher saw: …". This happens only when the run is submitting, or at the review with submit/self.
  - With no match, the page asks "Did it go through?". The same question shows after 2 minutes of "submitting".

## R6: Job Catcher readiness

- **Decision:**
  - `ExtensionInstall` (from Job Catcher's hourly hello) gives the newest install's version and last seen time.
  - Ready means version 0.41.0 or newer, seen in the last 2 hours. Anything else shows a warning with the update steps.

## R7: "&amp;" in saved jobs

- **Cause:** pages and APIs (RemoteOK, JSON-LD) hand titles over HTML-escaped, and nothing unescaped them.
- **Decision:**
  - A SQLAlchemy `@validates` on JobListing title/company/location unescapes on every save, from any source.
  - Job Catcher's `clean()` decodes too.
  - A migration fixes the stored rows (`&lt; &gt; &quot; &#39; &#x27; &nbsp;`, then `&amp;`).
