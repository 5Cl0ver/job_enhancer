# UI contract: Know where every job came from and where it went

Same actions on phone and computer; only the arrangement differs. Dialogs are
bottom sheets under 768 px (existing behaviour). Touch targets ≥ 44 px.

## 1. Origin label (cards, rows, job page)

One small label with an icon, replacing today's "Manual":

| Origin | Label | Icon |
|---|---|---|
| `scout` | Claude Scout · fit 8/10 | sparkles |
| `email` | From an email | mail |
| `extension` | Job Catcher | puzzle |
| `claude` | Saved by Claude | sparkles |
| `search` | Job board search | search |
| `manual` | Added by you | pencil |
| null | (nothing) | |

- Kanban card and phone row: the label sits in the meta line, muted, never
  wraps (truncates after the fit score).
- An email-made job whose name is doubtful shows one amber line under the
  title: **Check this job's name** → opens Rename.

## 2. My Jobs

- **Where from** filter next to the stage filter: All · Claude Scout · From an
  email · Job Catcher · Saved by Claude · Job board search · Added by you. Only
  origins the user actually has are listed. On phone it lives in the existing
  filter sheet. The choice is kept in the URL (`?origin=`).
- `?folder=<id>` selects that folder on load. An unknown id falls back to All
  jobs with no error.
- The folder list refetches whenever a job is saved anywhere in the app.

## 3. Job page and job pop-up: "Where this came from"

A compact block at the top of the side column (phone: first fold under the
title), one of:

- **Claude Scout**: "Found by Claude Scout on LinkedIn · 19 Nov · fit 8/10",
  then **Why it fits** and **Gaps** (two short paragraphs, folded past three
  lines), then **See the search that found it** → History on that run.
- **From an email**: "Made from an email · 19 Nov", **View email** (the in-app
  viewer) and **Open in Yahoo Mail**.
- Others: one line ("Saved with Job Catcher · 12 Nov").
- Always: "In folder **IT Admin**" → My Jobs on that folder.

The main button: **Apply Now** for jobs with a posting link; **Open the email**
for email-made jobs (their link is the email, not a posting).

**Rename** (pencil by the title): a small form with Title, Company, Place,
Link. Save is the only primary button. A 409 shows "You already have this job
saved" inline.

## 4. Search form: Save into

Under "How far around it", one select:

```text
Save into   [ A folder named "IT Admin"  ▾ ]
              A folder named "IT Admin"        ← default, follows the resume type
              ── Your folders ──
              Applied this week
              Scout
              ── 
              New folder…                      ← turns into a text field
```

And one switch: **Save good fits without asking** — "Skips the review. Use this
when you won't be around when it finishes." Off by default.

The search card shows "→ IT Admin" after its summary, and "saves without
asking" when that's on.

## 5. Review (the new step)

Shown on the Scout tab as soon as a run has something to review, above the
searches, and in History on that run. While the run is still going it fills in
live; the button works at any point.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Claude found 5 jobs · LinkedIn · IT Admin                            │
│ Pick what to keep.                                                   │
│                                                                      │
│ ☑  Systems Administrator · Vellacor              fit 8   View ↗      │
│    Why: 6 yrs Windows Server + Entra ID match…   Gap: no Intune      │
│ ☑  IT Administrator · Quillstone                 fit 7   View ↗      │
│ ☐  Help Desk Lead · Brambleworks                 fit 5   View ↗      │
│    Below your bar of 6: mostly phone support                         │
│ ─  Network Engineer · Tessaline       Already in My Jobs · Open      │
│ ─  IT Manager · Orrowfield            Couldn't copy the page         │
│                                                                      │
│ Save into  [ IT Admin ▾ ]            [ Save 2 to My Jobs ]           │
└──────────────────────────────────────────────────────────────────────┘
```

- When the run found fewer than asked, one muted line under the heading says
  why, and the numbers add up: "Asked for 5, found 2. Looked at 24 postings:
  9 seen in earlier searches · 4 skipped by title · 2 already in My Jobs ·
  3 below your bar · 1 couldn't be copied." Claude's closing note follows when
  there is one. **Keep looking** runs the same search again (seen postings are
  skipped, so it carries on from there).
- Picks are ticked, below-bar ones unticked, in fit order. Rows without a page
  copy and duplicates have no box.
- A row expands to Claude's full why and gaps. **View** opens the posting.
- The folder select has the same options as §4; "New folder…" takes a name.
- The button counts the ticks: **Save 2 to My Jobs**. With none ticked it reads
  **Keep none** (secondary style) and clears the review.
- After saving, the panel becomes one line: **2 saved to My Jobs › IT Admin ·
  View**. Failures are listed under it by job, with the reason.
- Phone: the same list as full-width rows; the folder select and the button sit
  in a bar pinned above the tab bar.
- Find Jobs gets a count badge (computer sidebar and phone tab) while anything
  waits for review.

## 6. History

- Run header: "5 found · 2 saved to **IT Admin**" with the folder as a link, or
  "2 waiting for you · **Review**". The same "Looked at 24 postings…" line sits
  under it.
- Each finding row, by outcome: saved → **Open in My Jobs**; picked → shown in
  the review; skipped / below the bar with a copy → **Save**; duplicate → **Open
  in My Jobs**; no copy → "Couldn't copy the page" and the posting link.

## 7. Email updates: when the name isn't clear

On an email update with no job, when the app couldn't read a clean title or
company, **Add to My Jobs** opens the two fields (pre-filled with its best
reading, empty when it has none) before adding. When both read cleanly it adds
in one press, as today.

## 8. Words

"Collection" everywhere in the app: it is the word the app already uses and
the one the user says (this document's "folder" means the same thing). "Claude
Scout" for the feature, "search" for a saved search, "run" only in History. No
"Manual".
