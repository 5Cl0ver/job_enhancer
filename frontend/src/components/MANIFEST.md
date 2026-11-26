# Frontend Components Manifest (`frontend/src/components/`)

React components (Vite + TypeScript + Tailwind + shadcn/ui). The **pages** that
use them live in `src/routes/` (see its MANIFEST); the **data hooks** live in
`src/hooks/` (see its MANIFEST). Feature status: [docs/FEATURES.md](../../../docs/FEATURES.md).

```
ui/  base shadcn primitives   layout/  the app frame's pieces
common/  shared page pieces (empty / error states)
jobs/ tracker/ ai/ analytics/ admin/ settings/   feature UI
```

`theme-provider.tsx` — app theme context (light/dark/system) + `useTheme`; puts
the `dark` class on `<html>`. Initial class is set pre-paint by an inline script
in `index.html`; wired in `src/providers.tsx`.

## `ui/` — shadcn/ui primitives
alert, badge, button, card, dialog, dropdown-menu, input, label, select,
separator, skeleton, sonner (toasts), switch, table, tabs, textarea. On touch screens
(`pointer-coarse:`) buttons, inputs, selects and tabs are 44px tall. `dialog` is a
centred box from 768px and a bottom sheet below it (scrolls inside, footer pinned). Themed via CSS variables in
`src/globals.css`; use `cn()` from `lib/utils`.

## `scout/` — Claude Scout (Find Jobs → Claude Scout)

| File | Purpose |
|------|---------|
| `ScoutPanel.tsx` | The Claude Scout tab: views Start · History · Resume types (`?view=`) |
| `ScoutStart.tsx` | Saved searches (create/edit/delete, each with "Save into" and "save without asking"), Start (queues a run), the open run: the one line to say to Claude in Chrome + live progress; finished searches whose good fits are waiting, each with its review |
| `RunReview.tsx` | The review: Claude's good fits ticked, the rest unticked, the collection pre-filled, one "Save N to My Jobs" button; `SavedNote` says where they went, with a link |
| `FolderSelect.tsx` | "Save into": the search's own collection, one of the user's, or a new one named on the spot |
| `ScoutHistory.tsx` | Past runs; open one to see what it found (and, for Local companies, how many companies it checked) |
| `RunTip.tsx` | Under a search that came back short: the app's one-line tip on what to change (wait a day, a wider "Posted", a bigger radius, more titles on the resume type) |
| `BroadOverrides.tsx` | In an "Anything I'd be good at" search's settings: Always search / Never search / Skip-these-words lists, and the folded "Titles tried" list |
| `RunTitles.tsx` | In History, a broad run's "Claude searched for:" titles with good fits; Always, Never and Add to resume type on each |
| `SkippedSites.tsx` | Sites to skip (spec 024), first on the Instructions tab (`#sites-to-skip`): paste a link or a site, the list with ✕, a warning before skipping a site Scout searches, and suggestions from the user's own finds ("Skip it") |
| `ScoutInstructions.tsx` | The Instructions tab: Sites to skip, then everything Claude is told, the editable parts (Original / Edited) then the locked ones (rules, fixed limits, tool descriptions), and Preview |
| `InstructionEditor.tsx` | One editable section: text, scoring (live total of 10) or limits (with ranges); Save, Reset to original, History with Restore |
| `ScoutPreview.tsx` | Pick a search: the brief Claude would get if it started now, without starting it |
| `TrackMemory.tsx` | On a resume type's card: "Fill skills from my resume" when it has none, and the titles Claude passed over (View, Start fresh) |
| `RunLog.tsx` | In History: a run's log in plain words, each call's detail (what Claude sent, what the app answered) behind a tap, refusals marked |
| `ScoutCompanies.tsx` | Above History: the local companies checked, folded away; each links to its careers page, with "Check next run" and "Never check" |
| `RunFindings.tsx` | A run's jobs, best fit first: saved (links to the job and its collection), passed on or below bar (Save to My Jobs while the page copy exists), already had, not copied (open and press Save); Claude's reasons labelled as Claude's |
| `errorText.ts` | The server's `detail` message for a failed request |
| `ResumeTypes.tsx` | Resume types: five suggested types to start, cards, add/edit/delete dialog, resume upload that keeps the main resume, View (in the app viewer) |
| `JobResumeType.tsx` | Resume type picker on a saved job's page |

## `layout/`
| File | Purpose |
|---|---|
| `Navbar.tsx`, `Sidebar.tsx` | ⚠️ Legacy shell — the live app frame is `routes/DashboardLayout.tsx`; these are pending consolidation |
| `OfflineBanner.tsx` | Offline indicator when the browser goes offline |
| `nav.ts` | The page list: desktop sidebar order, the phone's three tabs (`TABS`) and its More sheet (`MORE`), admin-only filtering, `pageFor(path)`, `signOut` |
| `PhoneNav.tsx` | The phone frame (under 768px): `TopBar` (page title, back arrow on inner pages, a slot for the page's buttons via `TopBarActions`), `TabBar` (My Jobs · Email with count · Find Jobs · More → sheet with the rest + Sign out), `CountBadge` |

## `email/`
| File | Purpose |
|---|---|
| `JobEmails.tsx` | "Emails about this job": why a job is in its stage. Each email says what it was and what it did to the card, with **View email** (quick read here) and **Open in Yahoo Mail / Gmail** (the message itself). On the job page, the board's job dialog; says so when a job has none |
| `email/RecheckCard.tsx` | "Missed an email?": re-check the last 30 days with today's rules (spec 027), progress and result; never moves a card |
| `email/JobEmailLists.tsx` | Email updates (spec 027): **New emails on your jobs** (kept on a job, not seen yet; opens the job) and **Looked at, not shown** (30 days, the reason, "This is about my job" puts it on a picked job). `JobEmails` shows a job's emails in sections (Interviews & next steps, Decisions, Your application, Messages from people, Other), "Latest: …", New, and marks them seen; board cards show "New email" |
| `EmailViewer.tsx` | One email, fetched read-only when opened and shown as plain text, with the link to the message in the user's own mail and a search fallback |

## `jobs/`
| File | Purpose |
|---|---|
| `SearchBar.tsx` | Query + location inputs → URL params |
| `SearchFilters.tsx` | Remote/type/salary/experience filters → URL params |
| `SearchResults.tsx` | `useJobSearch` → grid of `JobCard` + pagination |
| `JobCard.tsx` | Job card: title, company, salary, apply/save; a saved job shows where it came from (`OriginLabel`), a search result its feed |
| `JobActions.tsx` | What you can do with a saved job, identical in the board's pop-up, the list's pop-up and the job's page: write to the company, research it with Claude, Contact Further, Never this site (adds the job's site to Sites to skip; not for a job made from an email) |
| `SameJob.tsx` | `JobPicker` (the user's saved jobs, likeliest first, with search) and `SameJobButton` ("Same job as…" on a job made from an email: folds it into the real job, with Undo) |
| `RenameJob.tsx` | Fix a saved job's title, company, place or link (`RenameButton`, a sheet on a phone); `NameCheck` / `NameCheckLine` flag a name read from an email that may be wrong |
| `OriginLabel.tsx` | Where a saved job came from, as an icon and a few words ("Claude Scout · fit 8/10", "From an email"); nothing when unknown |
| `WhereFrom.tsx` | "Where this came from" on the job page and pop-up: origin, Claude's why/gaps and a link to the Scout search, the email it was made from, and its collection |
| `SavedJobsBody.tsx` | My Jobs list on a computer: folders, filter bar, card grid drawn 30 at a time |
| `JobCoverLetterPicker.tsx` | "Cover letter for this job" (spec 031): pick one of your letters (this job's first) or None, View it in the app, Edit text (the PDF is remade); hidden until you have one. `CoverLetterCard`: the application page's small card |
| `StagePicker.tsx` | A saved job's stage as a coloured pill you can change (the board's move, from the job page; pinned at the bottom on a phone) |
| `PhoneJobList.tsx` | My Jobs list on a phone: rows (about ten a screen), stage chips with counts (remembered per device), search, filters in a bottom sheet, 30 rows at a time |
| `JobDetail.tsx` | Full job view (legacy; no `/jobs/:id` route yet) |
| `SaveButton.tsx` | Optimistic save/unsave toggle |
| `SaveSearchButton.tsx` | Save current search criteria (FR-024) |
| `CollectionSidebar.tsx` | Collection list + create/delete + filter |
| `AddJobDialog.tsx` | Manually add a job by URL (`source=manual`) |
| `ApplyButton.tsx` | Opens external apply link + "Mark as Applied" confirm |

## `tracker/`
| File | Purpose |
|---|---|
| `KanbanBoard.tsx` | The board: search box (`/`), `DndContext` (mouse + touch), columns, drag-end → `useMoveJobStage`; a failed move toasts with Retry. Fills the window; loading / error / empty states |
| `PipelineColumn.tsx` | One stage. The whole column is the drop target (never its cards), scrolls on its own, draws 30 cards at a time, shows "n of N" while searching; an empty stage collapses to a strip |
| `KanbanCard.tsx` | `CardFace` (the look, also used while dragging) + `KanbanCard` (draggable, opens details, "Move to" menu for phones and keyboards) |

## `common/`
| File | Purpose |
|---|---|
| `EmptyState.tsx` | Nothing here yet: what belongs on the screen + one button for the next step |
| `ErrorState.tsx` | A load failed: plain words + Try again |
| `AllowanceNote.tsx` | "4 of 5 live searches left today ⓘ" (spec 019 part C); nothing for the owner or a kind not in use |
| `InfoBubble.tsx` | The ⓘ (spec 019): what it is, why it helps, what it needs (text in `lib/help.ts`); hover or click on a computer, tap on a phone, Esc closes (Base UI Popover) |
| `PdfViewer.tsx` | A PDF drawn in the app (spec 025): every page on a canvas (PDF.js, lazy), as wide as the viewer and sharp on phone screens, zoom, Download; a .docx says it can't be shown, with Download |
| `FileViewer.tsx` | `FileViewerDialog` / `useFileViewer`: one of the user's own files (résumé, document PDF) fetched with the sign-in token and shown in `PdfViewer` (a box on a computer, a tall sheet on a phone); `resumeFile` / `documentFile` paths |

## `onboarding/` — the Welcome and Getting started (spec 019)
| `ResumeStep.tsx` upload, read (no AI), check name/phone/city/LinkedIn, "We found N jobs" · `JobCatcherStep.tsx` get it (computer) or send the link (phone), Connected ✓ by itself · `ExtrasStep.tsx` email and Claude, optional · `GettingStarted.tsx` the checklist card on Find Jobs and My Jobs (I'm all set, Open the welcome again) |

## `ai/` (final phase)
| File | Purpose |
|---|---|
| `ResumeUpload.tsx` | Drag-drop PDF/DOCX upload (≤10 MB) |
| `GeneratedDocViewer.tsx` | Tabbed resume/cover editor + AI-transparency footer |
| `DocumentControls.tsx` | Regenerate / copy / View PDF (in the app viewer, Download there) |
| `JobDocuments.tsx` | Per-job résumés/cover letters (incl. Claude connector drafts): read, edit, copy, View PDF (in the app viewer) |

## `autofill/` — the Autofill memory page

| File | Purpose |
|------|---------|
| `TaughtBoxesCard.tsx` | Boxes taught with Job Catcher's "Point at a box", by site; change or remove |
| `ResumeDetailsCard.tsx` | Each résumé's details (jobs, schools, skills, certifications, websites) read with no AI; check and fix |
| `LanguagesCard.tsx` | Languages for application language sections: fluent/native, levels 1–5 per ability (spec 020) |

## `settings/`
| File | Purpose |
|---|---|
| `AppearanceCard.tsx` | Theme picker (Light / Dark / System) via `useTheme` |
| `ApplicationProfileCard.tsx` | Reusable autofill answers (name, links, etc.) |
| `SavedAnswersCard.tsx` | Answer Library & insights: learned answers grouped by topic, searchable, with usage stats; edit/delete; answers learned from Claude's approved runs say "From Claude" (spec 029) |
| `EmailConnectCard.tsx` | Connect inbox for auto-status detection |

## `analytics/`
| `StatCard.tsx` | icon + value + trend arrow · | `ActivityChart.tsx` | recharts bar chart |

## `admin/`
| `HealthPanel.tsx` external-service status · `StatsOverview.tsx` user-count cards · `UserTable.tsx` paginated users with setup dots, Job Catcher version (old ones marked), last active and today's use · `AllowancesCard.tsx` the daily free allowances and the JSearch reserve · `BugReportsCard.tsx` Bug reports: problems Claude ran into on everyone's applications, grouped by kind, open / all, Fixed / Ignore, Copy for Claude / Copy all open as Markdown (spec 030) · `SignupTrendChart.tsx` recharts line chart |
| `apply/*` (spec 022) | `ApplyWithClaudeButton` (job page; asks which résumé first, spec 025), `ResumeReview` (look over Claude's résumé: Use it / Change something / ask Claude, spec 025), `LiveFill` (Filling now: the boxes as Job Catcher reads them, spec 026; tap one to change it or ask Claude while it fills, `LiveFixSheet`, spec 030), `Bubbles` + `ReviewBoard` (answers as bubbles: check these first, change or ask Claude, fixes sent together, spec 026), `ApplySteps`, `Questions` (Claude's questions as one checklist: its guesses filled in, quick answers, only-you rows first, Looks good, go; spec 030), `Problems` (Problems Claude ran into, closed until tapped; spec 030), `ResumeForJob` (view in the app, edit text → PDF remade, change), `Pages` (photos + answers, full-size viewer), `Review` (Submit / Fix / I'll submit it myself), `ApplyBanner` (every screen while Claude waits for you), `WhatYouSent`; `settings/ResumesCard.tsx` (tap a résumé to view it in the app; master résumé, made for a job, things you've told Claude), `settings/ReviewResumesCard.tsx` (the look-it-over setting) |
| `apply/Remote.tsx` (spec 023) | The application page as a remote control: `HelpCard` (Claude's question, a photo of the screen, quick answers, your own words; CAPTCHA/sign-in "needs you at the computer"), `Conversation` (Claude's updates and your messages, Read by Claude), `ScreenNow` (Show me the screen), `Stopped` (Claude went quiet + the carry-on line), `DidItGo` (It was sent / It wasn't), `Readiness` (Job Catcher 0.41.0+ seen lately), `SentCard` (Sent, confirmed: what Job Catcher saw) |

**How this folder connects:** components are composed by `routes/*`; they get
data via `hooks/*` → `lib/api.ts` → FastAPI.
