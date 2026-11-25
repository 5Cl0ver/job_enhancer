# Feature Specification: Claude Scout keeps going (and searches better)

**Feature Branch**: `021-scout-keeps-going` (part A) · `021-scout-local-companies` (part B)

**Created**: 2026-11-24

**Status**: Built

**Input**: The user, 2026-11-24:
> "Sometimes, like my recent runs, it literally only looked through like 10 jobs, 3 jobs, and then it gave up. I don't want it to give up, but I don't want it to endlessly run forever."

They want more 7+ jobs found. They love the near-misses (5s and 6s) and want to keep them. The look of the app stays the same.

**What a live audit of the user's runs found** (counts only; see research.md):
1. **No plan B.** A run ends when its searches are read. A thin search was widened once, only on job boards, and only when it had fewer than 25 results. Google was never widened.
2. **Google Jobs worded wrong.** "IT Systems Engineer jobs within 35 miles of Beaverton" returned 3, 0, 0, 0, 0, 0, 0 and 2 jobs over 8 searches.
3. **Remote jobs left out.** "Remote OK" still searched only around the town.
4. **A town without its state.** "Beaverton" can be another Beaverton.
5. **Claude quit on hiccups.** An Indeed run stopped after 1 of 8 searches because page copies didn't arrive.
6. **Local companies searched the wrong businesses.** Two of three Google searches were industry kinds (logistics, insurance). Sites that didn't load were recorded as "no openings" for a week.

## User Scenarios & Testing *(mandatory)*

### User Story 1: A short run keeps going, within a limit (Priority: P1)

When every search is read and the run still has fewer good fits than asked, it adds more searches one step at a time:
1. remote jobs anywhere in the country, for the same titles (only when remote is OK and there's a place);
2. the past 14 days (only when the window was shorter);
3. the resume type's titles this round left out.

It stops adding searches once it has looked through the "looks" limit of jobs (200 by default, editable 50–500 in Instructions › Limits), or when there's nothing left to add. The finish line says how many jobs it looked through and how it kept going.

**Acceptance:**
- A run that reads both of its searches without reaching its target gets "keep going" with a remote search next.
- A run that reached its target never adds searches.
- A run past the limit gets "looked through N jobs, its limit".
- Local companies never keep going this way.

### User Story 2: Google and the boards are asked properly (Priority: P1)

- **Google:** "{title} jobs near {place}" plus the window in Google's own words ("since yesterday", "in the last 3 days", "in the last week", "in the last month"); never "within N miles of". Thin Google searches widen once, like the boards.
- **Remote searches:**
  - LinkedIn: United States, geoId 103644278, f_WT=2.
  - Indeed: l=Remote plus Indeed's Remote filter.
  - ZipRecruiter: refine_by_location_type=only_remote.
  - A "remote only" search on LinkedIn now covers the whole country, not remote jobs in one town.
- **Place with state:** a bare town that matches the application profile's city gets its state ("Beaverton, OR") in the links, the brief's place and the area rule.

### User Story 3: One job never ends a run (Priority: P1)

The locked rules say: stop only when the job board itself shows a CAPTCHA, a login wall, or won't load at all. A posting that won't copy, is gone, or errors is reported (or skipped) and the run goes on.

### User Story 4: Local companies look where IT people work (Priority: P2, part B)

- All three Google searches come from the user's titles; industry kinds fill in only when there are fewer than three, and only kinds that employ IT staff.
- A new "couldn't check" result (site down, cookie wall, broken job search) is tried again next run, not skipped for a week.
- National companies with only a branch nearby are left out.

### Edge Cases

- **Added searches share their words with the first ones.** A page of the one being read is never mistaken for a resend of an earlier search.
- **A resumed chat** (a new Claude chat with the same run) carries on at the added searches.
- **Saved custom limits from before** keep working; "looks" falls back to 200.

## Requirements *(mandatory)*

- **FR-001:** A run short of its target adds the keep-going steps in order. Each step adds only searches that apply.
- **FR-002:** A run stops adding searches at the "looks" limit, and skips the rest of the added searches once past it. The first searches always run as before.
- **FR-003:** Google links use "near" and a window in words; thin Google searches widen once.
- **FR-004:** Remote searches use each board's remote filter and the whole country.
- **FR-005:** The place carries its state when the profile's city matches.
- **FR-006:** The locked rules never end a run for one job's problem.
- **FR-007:** The finish line reports jobs looked through and the steps taken. The per-search line names at most 8 searches.
- **FR-008:** Local companies: title-based searches, IT-heavy kinds only, a "not_checked" result retried next run (part B).
- **FR-009:** No screens change look. The only visible additions are the new limit in Instructions › Limits and the "(remote)" or "(past 14 days)" names in a run's searches.

## Success Criteria *(mandatory)*

- **SC-001:** No run ends while searches remain to add and it is under the limit.
- **SC-002:** Google searches return jobs for common titles (verified on the next live run).
- **SC-003:** All existing Scout tests still pass; new tests cover every step, link and limit.
