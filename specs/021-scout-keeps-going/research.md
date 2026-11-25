# Research: Claude Scout keeps going

## R1: Why runs ended early (live audit, 2026-11-24, counts only)

| Run | Looked at | Why it ended |
|---|---|---|
| Google Jobs, 8 titles | 7 | Searches returned 3, 0, 0, 0, 0, 0, 0, 2 |
| Indeed, 8 titles | ~20 | Claude quit after 1 search, because the page copies weren't arriving |
| LinkedIn "today" | 4–6 | Only that many posted in 24 hours |
| Local companies | 6 | 15 companies, mostly logistics and insurance |
| LinkedIn, broad | 140 | 2 kept; the same Dynamics 365 job came up 5 times across searches |

- All-time, 24 of 112 reported jobs scored 7 or more.
- Claude's yes/no calls on job titles looked sensible.

**Decision:** add a step-by-step "keep going" ladder, ended by a jobs-looked-through limit, rather than raising every per-run limit. That way, a run that already finds enough stays as short as before.

## R2: Google Jobs wording

- JobSpy's Google scraper uses "{title} jobs near {place}", plus "since yesterday", "in the last 3 days", "in the last week" or "in the last month".
- "within N miles of" isn't documented anywhere.
- About 10 jobs per query, with no page 2. More queries, not more pages.

**Decision:** that wording. Thin Google searches widen once.

## R3: Remote filters

- **LinkedIn:** f_WT=2, with location United States and geoId 103644278. One search can't be both "Beaverton or remote".
- **Indeed:** sc=0kf:attr(DSQF7); with l=Remote.
- **ZipRecruiter:** refine_by_location_type=only_remote.
- Sources: scraper docs and JobSpy; the boards blocked automated checking. Verify on the next live run.

## R4: Order of the steps

Remote first: it's the largest pool the local searches miss. Then a longer window, which is cheap because rows already seen are skipped and their pages end quickly. Then the titles left out.

**Rejected:**
- **Interleaving remote with the first searches:** it changes runs that already work.
- **Asking Claude for more titles on broad runs:** it already picks 8.

## R5: Searches that share words

LinkedIn's added searches share their keywords with the first ones. `_link_of` used to return the first match, so a remote page would read as "a page of a search already done" (a resend).

**Decision:** the search the run is on wins when the words match.

## R6: Local companies (part B)

- Industry kinds pulled in trucking and insurance firms.
- Unloadable sites, cookie walls and broken searches were recorded as "none" and skipped for 7 days.

**Decision:** title-based searches, IT-heavy kinds only to fill in, and a "not_checked" result that is due again next run.
