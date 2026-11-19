# Contract: screens

What each screen must show and do. Wording is plain; no jargon in the UI.

## Shell (`routes/DashboardLayout.tsx`)

- Desktop sidebar: icon + label per item, a count pill on **My Jobs** (open
  to-dos) and **Email Updates** (to review). Order: Find Jobs · My Jobs ·
  Email Updates · Matches · AI Apply · Analytics · Settings (· Admin).
- Phone: bottom bar with Find Jobs · My Jobs · Email (count) · More. **More**
  opens a sheet with the rest and Sign out.
- `Ctrl/⌘+K` opens a command palette: jobs by title or company (opens the
  drawer), pages, "Scan inbox", "New Scout search".
- Toasts bottom-right (desktop) / top (phone); an error toast carries Retry
  when the action can be retried.

## Shared pieces (`components/common/`)

| Piece | Rule |
|---|---|
| `PageHeader` | one `h1`, one line of help, primary action on the right |
| `EmptyState` | icon, one sentence on what goes here, one button for the next step |
| `ErrorState` | what failed in plain words + **Retry**; never raw server text |
| `ListSkeleton` / `BoardSkeleton` | shown on first load only, not on refetch |

## My Jobs (`routes/MyJobsPage.tsx`)

```text
My Jobs                                            [List | Board]
[ Search jobs or companies… ( / ) ]  (Needs you 2) (Remote) (Resume type ▾) (No reply 7d+)

Needs you (2)                                              [Hide]
 ● Assessment to do · IT Administrator · Vellacor          [Done] [Open]
 ● Interview: reply and prepare · Systems Analyst · Brambleworks
 Suggested: 5 jobs with no reply in 7+ days                [Show]

┌ Applied 183 ──┐┌ Phone 1 ┐┌─┐┌ Interview 2 ┐┌─┐┌ Rejected 16 ┐
│ (scrolls)     ││         ││ ││             ││ ││ (scrolls)   │
│ Show 30 more  ││         ││ ││             ││ ││             │
└───────────────┘└─────────┘└─┘└─────────────┘└─┘└─────────────┘
```

- The board area takes the rest of the window height; the page itself does not
  scroll on desktop. On a phone the board is one column at a time with a stage
  switcher (chips with counts) above it.
- **Card**: title (2 lines max), company · location, one status line ("Applied
  3 d ago"), to-do badge if any (colour by kind), resume type dot. Hover/focus:
  lifts 2 px, stage-coloured ring, quick actions appear (Open · Move to… ·
  Contact further). Click opens the drawer.
- **Search**: matches highlight (ring + the matched text marked), others dim to
  40%; each column header shows "3 of 183". Enter jumps to the first match and
  pulses it. Esc clears.
- **Moving**: drag to a column (the whole column highlights as the target), or
  Move to… . Success is silent; failure toasts "Couldn't move it. Retry".
- **Empty stage**: collapsed rail with the stage name vertical and its count;
  expands on click or while a card is dragged over it.
- **No jobs at all**: one EmptyState with "Find jobs".

## Job drawer (`components/jobs/JobDrawer.tsx`, a right-side sheet)

Header: title, company, stage selector, Open full page, Apply link.
Sections in order: **To do** (list + "Add a to-do"), **Emails about this job**
(each opens the viewer), **Notes**, **Resume type**, **Details** (location, pay,
posted, source). Opened by `?job=<saved_job_id>` so it can be linked.

## Email Updates (`routes/EmailUpdatesPage.tsx`)

- Top card: account, last checked, **Scan inbox**. While scanning:
  "Checking Inbox… 350 emails checked · 6 updates found" with a thin progress
  line; the button reads "Scanning…" and the page stays usable. Stopped:
  "The scan stopped after 350 emails. Those are saved." + **Scan again**.
- Tabs: **To review (4)** · **History** · **Other mail**.
  - To review rows: company, job, what the email says, the move it proposes,
    **Move to X** / **Not this** / View email / See the job.
  - History rows: what happened and when ("Moved to Interview automatically ·
    today"), **Undo**, **See the card**. A to-do created from it is shown
    ("Added to Needs you").
  - Other mail: four collapsible groups, 50 per page.
- After an action: the row animates out and a toast says where it went
  ("Moved to Rejected · Undo"); it is then in History.
- Load failure: one ErrorState above the tabs.

## Email viewer

Subject, sender, date, folder; the text; **Open in Yahoo** / **Open in Gmail**.
If the email can't be fetched: says so and offers the same button.

## Find Jobs → Claude Scout

- **Start** opens with the checklist until all three are done (then collapses
  to one line):
  1. Resume types — "3 of 5 have a resume" → Set up
  2. Job Catcher 0.26+ and the Job Enhancer connector in Claude — two links,
     "I've done this"
  3. Make a search and press Start
- **Resume types** card: name, target titles, saved-job count, and either the
  file name with **Replace** or a dashed **Upload resume** drop area. Edit stays
  for titles, skills and skip rules.
- **Searches**: each resume type without a search offers "LinkedIn · 5 jobs ·
  last 7 days — Add". Live run and prompt copy unchanged.

## Motion

Card hover lift (120 ms), drop settle (150 ms), row leave (150 ms), highlight
pulse (one 600 ms cycle), sheet slide (200 ms). All disabled under
`prefers-reduced-motion`.
