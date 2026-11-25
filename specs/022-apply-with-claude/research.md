# Research: Apply with Claude

## R1: Who takes the photos

- **Decision:** Job Catcher takes them, with `chrome.tabs.captureVisibleTab`, at Claude's request through the app.
- **Why:** Claude in Chrome can see the page, but a connector tool can't send images to the app.
- **Permission:** `captureVisibleTab` needs `<all_urls>` (or activeTab). The browser test showed Chrome refuses `http(s)://*/*`, so Job Catcher's host permission became `<all_urls>`: the same all-sites access.
- **Limits:**
  - At most 2 captures per second (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`).
  - Only the visible part of the active tab is captured, so a long page is several photos: Job Catcher scrolls, shoots, then puts the scroll back.
- **Rejected:**
  - `chrome.debugger` full-page screenshots. Claude in Chrome already uses the debugger, and it adds the "is debugging this browser" bar.
  - Drawing the page into a canvas (html2canvas): a big dependency with poor fidelity in frames.

## R2: How Job Catcher hears about a request

- **Decision:** Job Catcher learns about an open apply run the way it learns about a Scout run: it asks the server.
  - Content scripts on visible pages send a tick to the background. The background asks `GET /v1/apply/active` (a 60 s cache when no run is open; a failed ask keeps the last answer and retries in 3 s).
  - While a run is open, the background asks every 2 seconds and does pending requests.
- **Keeping the service worker alive:** a call to an extension API resets its 30 s idle timer (Chrome docs, service worker lifecycle). The loop reads `chrome.storage.session` on each turn.
- **No request is done twice:** each request is claimed atomically (`pending → working`) before it is done.
- **The tool waits:** the connector tool (for example `page_done`) waits up to 25 s for the result. On a timeout it returns "no photo" and Claude carries on, so a missing Job Catcher never blocks a run.
- **Rejected:**
  - Pushing from the app to the extension. `externally_connectable` only carries the connect proof today, and widening it adds attack surface for little gain.
  - Alarms (30 s minimum: too slow while a run is open).

## R3: Which tab

- **Decision:** Claude passes the page's address with each request. Job Catcher picks the tab with the same host and path. Failing that, the active tab of the focused window if it is on the same host. Failing that, no tab ("The tab wasn't showing").

## R4: The Submit safety net

- **Decision:** while the run isn't approved, Job Catcher's page script blocks clicks and form submits whose button text is a final-submit phrase. Examples:
  - "Submit", "Submit application", "Submit my application", "Submit your application", "Send application".
  - Never "Next", "Continue", "Save" or "Review", and never "Apply"/"Apply now" (the button that opens an application). Never in a sign-in or one-time-code form.
- **Why:** Claude in Chrome's clicks are trusted events, so the block can't tell Claude from the user. That's why the user's own "I'll submit it myself" first lifts the block in the app.
- **Scope:**
  - **The lock:** every tab on the run's sites, with every frame in them (a form embedded from another site too), from the start of the run. The safety net never waits for Claude's first request.
  - **"Submit pressed":** this ends a "submit it myself" run as sent, so it only counts from the run's own tab (the one Claude's requests pointed at, still on the run's site). The user's other application on the same board never marks this one sent.
- **Stale state:** a last answer stands for 90 s while the app can't be reached. Signed out means no run.
- **False block:** a mid-form "Submit" just means an early review. Claude is told and asks for review.

## R5: Where photos and résumés live

- **Decision:** in Postgres (bytes), like résumé files today. There is no file storage service in this app.
- **Photos:** JPEG at 60% quality, at most 1200 px wide: about 80–200 KB each. Deleted 30 days after a run ends, by a cleanup that runs when a new run starts and on the daily keep-alive ping.

## R6: The tailored résumé

- **Decision:** Claude writes Markdown in the layout the PDF maker already renders. The app saves:
  - a `GeneratedDocument` (`model_used = "claude-connector"`), shown in the job's Documents;
  - a `Resume` row whose bytes are that document rendered to PDF, linked by `document_id`. It holds the master résumé's parsed history, so Workday sections fill.
  - It is set as the job's résumé (`saved_jobs.resume_id`), so Job Catcher's existing per-job choice uploads it.
- **Editing** the document remakes the PDF bytes.
- **Full, not short:** the owner was explicit. The playbook says to keep every real role.

## R7: Master résumé and the things the user told Claude

- **Decision:**
  - `resumes.is_master`: one per user; the master profile falls back to the active résumé.
  - A new `profile_facts` table (question, answer, the job it came from).
  - `_master_profile_text` adds a "Things I told Claude" section.
- **Rejected:** writing answers into the résumé file. It's the user's document; facts stay separate and editable.

## R8: Passwords

- **Decision:** never stored. Sign-in and sign-up go through "Claude needs you", and Chrome's password manager does the rest.
- **Why:** storing third-party passwords would make the app a credential vault, against the security rules.

## R9: Gap questions without AI in the app

- **Decision:** the brief includes the listing's skills that the master résumé and facts don't show, from the existing no-AI word match (`services/match.py`). Claude writes the questions; the app does no AI.

## R10: Capture bugs (part A, from the live data)

- **LinkedIn:** the description section includes the "… more" button's text. Strip button text when reading, and press visible "more" buttons inside the description before a Save.
- **Indeed:** when the embedded data misses, the title comes from `og:title` ("Title - Town, ST 00000 - Indeed.com"). Strip board tails and a location tail.
- **Board names as companies, titles equal to the company, and "careers-" subdomains:** filter them in the merge.
