# Feature Specification: Fixes from Bugs & ideas (cover letter you can see, long answers in full, JSearch "down")

**Feature Branch**: `039-app-cover-letter-health`

**Created**: 2026-11-27

**Status**: Built

**Input**: The owner's Bugs & ideas reports from real applications. (Examples below use invented companies and people.)

## The three problems, in plain words

- **A. The cover letter was hard to find.** Claude wrote and saved a cover letter, and it was attached to the job, but the app hid it: on the job's page it was the last thing, only once you had a letter, with View and Edit but no Download; on the application page it was low down; Settings had résumés but no letters; and the job page's file name was "Cover letter" (another list used `cover_letter-<id>.pdf`). The job page's **Generate Documents** button always failed: the app's own AI writing is off, so it answered "AI writing is paused".
- **B. Long Workday answers were cut and shown in a tiny box.** Job Catcher's reading of the page kept only the first 300 characters of each answer, and line breaks were flattened. The fix sheet showed what's in the box as one small grey line ("Now: …") and edited it in a one-line box.
- **C. "JSearch is down: No key set."** With no JSearch key, the health check said JSearch was down, and the health watch filed a caught bug for it. Job search already skips JSearch quietly with no key, so nothing was broken. A key the service rejected (401/403) looked healthy, and the admin panel never showed what each check said.

## What changes

- **A.** One cover-letter row, shaped like the résumé row: its readable name ("Cover letter - Northwind Labs.pdf") and date, **View** (in the app), **Download**, **Edit text** (the PDF is remade), and **Change** (pick another letter, or None).
  - Job page: right under the résumé, always there. With no letter yet: "None yet. Claude writes one when an application asks for it."
  - Application page: the same row, in the card right after the résumé's (Change works there too). Under the run's status: "Claude wrote a cover letter. View".
  - Settings: a new **Cover letters** part next to Résumés, every letter with the same row.
  - **Generate Documents** shows only while the app's AI writing is on; the app works fully without it. The AI-on path is unchanged.
  - The job's Documents list names its PDFs the same readable way and shows a letter's whole text (no small scrolling box inside the page).
  - The file Job Catcher attaches to an application keeps its name ("Sam Rivera - Cover letter.pdf").
- **B.** Answers are kept up to 2,000 characters with their line breaks (spaces folded, at most one blank line in a row) in the live reading, the sheet, the fix and what Claude gets (`now_on_page`). The fix sheet shows what's in the box now in full, in a readable block. A long answer (over 80 characters, or with line breaks) is edited in a box that grows with its text and starts with the current answer, so a small change is a small edit; leaving it unchanged isn't a fix. A short answer keeps its one-line box. In the list, a long answer shows 4 lines and **Show all** / **Show less** (only when it really runs past 4 lines; named for its question). Near the 2,000-character limit the box says "2,000 characters max". Whether a box already holds a fix, or now holds it, is judged on the whole answer (question keys stay folded to 200 characters), and the owner's own change keeps its paragraphs.
- **C.** A service with no key set (JSearch, Adzuna, NVIDIA) is **Off** ("Not set up"): never pinged, never reported by the health watch, and never marked "recovered" (an old outage report is left as it is). A key the service turns away (401/403) is "degraded: Key rejected"; like a healthy reading it's kept for 10 minutes, so the admin page (which asks every minute) doesn't spend Adzuna's daily calls on it. The admin panel shows Off in grey and what each check said under the service's name.

## Not changed here

Job Catcher (the extension) and the playbook are untouched. No live data is changed: the existing "JSearch is down" report stays open until the owner closes it.

## Acceptance tests

- **A**: the row shows the letter's readable name, when it was written, View, Download and Edit text; View opens it in the app; Download saves it under "Cover letter - Northwind Labs.pdf"; a saved job with no letters says "None yet…"; a job that isn't saved shows nothing; Settings lists every letter with the same row, or "None yet…" (nothing shows until the letters are in); the application page's Cover letter card comes right after the résumé's, has Change when the job is saved, and "Claude wrote a cover letter. View" opens the letter; Generate Documents is hidden while AI writing is off and shows when it's on; after Claude's `save_cover_letter`, `/v1/saved-jobs` names the letter and `/v1/ai/cover-letters` lists it. (frontend `CoverLetters.test.tsx`, `ApplyRunPage.test.tsx`, `GenerateDocuments.test.tsx`; backend `tests/test_cover_letters.py`)
- **B**: a 1,500-character answer with line breaks comes back whole from `save_live`, in the sheet, in a fix's `now` and in `now_on_page`; spaces fold, line breaks stay, 2,000 characters at most; the list row holds the whole text, folds to 4 lines with Show all / Show less, and a short one never folds; the fix sheet shows the whole answer and edits a long one in a pre-filled growing box (unchanged = Add fix stays off), a short one in a one-line box; changing the last sentence of a 1,500-character answer is a waiting fix, not "already there", and it settles once the box holds it; a typed change's paragraphs reach Claude as paragraphs. (backend `tests/test_apply_long_answers_039.py`, frontend `apply/LongAnswers.test.tsx`)
- **C**: no keys → JSearch, Adzuna and NVIDIA are Off, "Not set up", nothing pinged; five health-watch runs with no keys file no report; an open outage report isn't marked recovered; a 401 or 403 → degraded, "Key rejected", pinged once for two reads; the admin panel shows Off and each check's detail. (backend `tests/test_bug_reports_caught.py`, frontend `HealthPanel.test.tsx`)
