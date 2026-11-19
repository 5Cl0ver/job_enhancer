# Contract: phone screens (under 768 px)

Wireframes are 390 px wide. Desktop is unchanged unless a line says "both".

## Rules for every phone screen

- One 16 px gutter. Pages don't add their own side padding.
- 48 px sticky **top bar**: back arrow (on inner pages) · title · up to two
  icon actions · ⋯ for the rest.
- **Bottom bar**, 56 px + safe area: My Jobs · Email · Find Jobs · More.
- Buttons, chips, tabs, row actions: at least 44 px tall; icon buttons 44 × 44.
- Fields: 16 px text.
- Lists are rows separated by hairlines, edge to edge inside the gutter; cards
  are for things that stand alone (an email update, a running search).
- Pressing a row or button dims it (`active:`), since phones have no hover.
- Anything that was a dialog is a **bottom sheet**: rounded top, grab bar, a
  close button, content scrolls, primary button pinned at the bottom above the
  keyboard and the safe area.
- Nothing may be wider than the screen. Long titles truncate; long words wrap.

## Shell

```text
┌──────────────────────────────────────┐
│ My Jobs                    🔍  ⚙︎  ＋ │  top bar (title · search · filter · add)
├──────────────────────────────────────┤
│                                      │
│              page                    │
│                                      │
├──────────────────────────────────────┤
│  My Jobs    Email ④   Find    More   │  bottom bar
└──────────────────────────────────────┘
```

**More sheet**: Matches · AI Apply · Analytics · Settings · Admin (admins) ·
Sign out.

## My Jobs

```text
│ My Jobs                    🔍  ⚙︎¹ ＋ │
│ (All 303)(Applied 183)(Interview 2)› │  stage chips, scroll sideways
│ ⓧ Remote  ⓧ Portland                 │  active filters (only when set)
├──────────────────────────────────────┤
│ Identity and Access Management An…   │
│ Vellacor · Springfield, IL   Applied │
├──────────────────────────────────────┤
│ IT Systems Administrator          ⋯  │
│ Brambleworks · Remote      Interview │
├──────────────────────────────────────┤
│ …                                    │
```

- Row: 64 px. Line 1 title (one line). Line 2 company · place, then the stage
  chip (hidden when a stage chip is already filtering). A to-do badge replaces
  the stage chip when the job needs the user (004).
- Tap a row → the job page. ⋯ → action sheet: Move to… · Mark applied / Undo ·
  Contact further · Remove.
- 🔍 turns the top bar into a search field (with Cancel); results filter as
  typed, across all stages, with the stage shown on each row.
- ⚙︎ opens the **filter sheet**: Folder · Place · Pay · Type · Applied · Remote.
  Footer: **Clear** and **Show N jobs**. The icon shows how many are set.
- ＋ opens Add job as a sheet.
- 30 rows, then more as the end scrolls into view. Skeleton rows while loading.
- Empty: "No saved jobs yet" + **Find jobs**. No matches: "No jobs match" +
  **Clear filters**.
- No List/Board toggle. (≥ 768 px: both views as today.)

## Job page

```text
│ ←  Job                           ⋯  │
│ Identity and Access Management       │
│ Analyst                              │
│ Vellacor · Springfield, IL · $66–99K │
│ (Applied ▾)  (IT Admin résumé)       │
│ ── To do ──────────────────────────  │  (004)
│ ── Emails about this job ──────────  │
│ ── Description ────────────────────  │
│ first 8 lines…            Read more  │
├──────────────────────────────────────┤
│ [ Move to… ]        [  Apply now  ]  │  pinned
```

- The stage chip opens the same Move to sheet. Back returns to the list where
  it was scrolled.
- Long links and words in the description wrap.

## Email Updates

```text
│ Email updates                 ⟳   ⋯ │  ⟳ scan · ⋯ Email settings
│ ▔▔▔▔▔▔▔ Checking Inbox… 350 checked  │  only while scanning
│ [ To review 4 | History | Other ]    │  sticky
├──────────────────────────────────────┤
│ Vellacor                    today    │
│ IT Systems Administrator             │
│ Says you weren't selected            │
│ Applied → Rejected                   │
│ [   Not this   ] [ Move to Rejected ]│
├──────────────────────────────────────┤
```

- Tap the card (not a button) → **email sheet**: subject, sender, date, text;
  footer **See the job** · **Open in Yahoo**.
- Buttons are half width each, 44 px, primary on the right (thumb side).
- "Move cards automatically" moves to Email settings (⋯).
- After an action the card slides out and a toast offers Undo.
- Until 004's tabs ship, the segmented control shows today's sections as
  To review · Moved for you · Other.

## Find Jobs

```text
│ Find Jobs                            │
│ [ Job boards | Claude Scout ]        │
│ [ 🔍 Job title, skill or company   ] │
│ [ 📍 Anywhere ]  [ Filters ]         │
├──────────────────────────────────────┤
│ result rows (same row as My Jobs,    │
│ with Save on the right)              │
```

- The keyword field is always full width. Place and Filters open sheets.

### Claude Scout

Everything the computer has, nothing switched off.

- Start: each saved search is a card with name, one detail line and a
  full-width **Start**; ⋯ for Edit / Delete. A running search shows progress
  and its findings as rows, and the line to paste with a **Copy** button.
- History: runs as rows; tap for findings.
- Resume types: rows with the file name or **Upload résumé**; tap to edit in a
  sheet.

## Settings (phone)

A grouped list; each row opens its section as its own screen with a back arrow:
Profile · Email · Résumé & answers · Claude project · Appearance (theme, Show
Claude Scout) · Export & delete · Sign out. No more 4-screen scroll.

## Matches · AI Apply · Analytics

Same top bar, gutter, rows and sheets. Analytics cards stack one per row with
the chart full width. AI Apply's viewer is a full-screen page with its actions
pinned at the bottom.

## Sheets

| Sheet | Height | Closes with |
|---|---|---|
| More, Move to, row actions | fits content | tap outside, ✕, Back |
| Filters, Place | up to 92% | ✕, Back, Show N jobs |
| Add job, Scout search, resume type | 92% (has fields) | ✕, Back, Save |
| Email viewer | 92% | ✕, Back |

## Motion

Sheet slide-up 200 ms; row press 80 ms; card leave 150 ms; chip underline
slide 150 ms. All off under `prefers-reduced-motion`.
