# Research: Sites to skip

## R1: Where the reposting sites come from (live data, read only, 2026-11-25)

| Site | Claude Scout finds (of 151) |
|---|---|
| learn4good.com | 13 |
| jobleads.com | 7 |
| adzuna.com | 3 |
| remoterocketship.com | 3 |
| us.trabajo.org | 2 |
| recruit.net, talent.com | 1 each |

- They come mostly from Google Jobs' "Apply on …" choices, where Claude picks a link.
- Saved jobs from the free searches are mostly jobicy and remoteok (API sources, not Claude), so they're out of scope.
- **Decision:** the list acts on Claude Scout and Apply with Claude, the two places Claude picks links. It does not act on the free API searches. A later version can add that if the owner asks.

## R2: Storing the list

- **Decision:** a small table `skipped_sites`: one row per user and site, unique on the pair.
- **Rejected:**
  - A JSON list on the user: harder to keep unique, and it changes a table everything reads.
  - An Instructions text section: Claude would read it every run (tokens), and the app couldn't check it cheaply.

## R3: When the list is read

- **Decision:** read live, with one indexed query, when `check_jobs` and `report_job` run and when a brief is built. A site added mid-run takes effect on Claude's next call.
- **Rejected:** a snapshot in the run's criteria at Start. A site added while watching a run wouldn't apply until the next run.

## R4: Token cost (the owner's worry)

- **The checks** happen on the server (a set of hosts per call) and cost Claude nothing.
- **What Claude reads:**
  - The Scout brief: one line, "Never use these sites: a.com, b.com…" (at most 100 sites, about 1–2 KB at the very most; a handful in practice).
  - The Apply brief: one line, only when the job's own link is on a skipped site.
  - A refusal: one sentence.
- **No new connector tools**, and no new calls.

## R5: Matching

- **Decision:** lowercase the host and drop "www.". A site matches when `host == site` or `host.endswith("." + site)`.
- Pasting a full link keeps only its host.
- A bare word without a dot is refused.
- This is the same rule as Job Catcher's `onRunHost` (spec 022), already tested against look-alikes.

## R6: Not breaking Scout

- **Decision:**
  - Warn before skipping linkedin.com, indeed.com, ziprecruiter.com or google.com. Scout searches those, and skipping one would empty a whole source.
  - Skipped rows count under a new "skipped sites" reason in the run log, the same way "excluded" works today.
  - Results, near-misses and the look of Scout don't change.

## R7: Suggestions

- **Decision:** a short built-in list of known reposting sites (learn4good, jobleads, adzuna, remoterocketship, trabajo.org, recruit.net, talent.com, jooble, lensa, jobrapido, bebee, ziprecruiter-style redirects excluded). Only the ones that appear in this user's own Scout finds are shown, each with a one-tap "Skip it". They are never added on their own.
