# Research: LinkedIn's search links (011)

None of this is official LinkedIn documentation; LinkedIn doesn't publish one.
These are public notes and tests, so the app also checks itself on every real
run: Claude sends the address LinkedIn landed on, and the run's log and
History list any filters the redirect dropped.

| Parameter | What public notes say | What the app does |
|---|---|---|
| `keywords` | Works signed in and out. Quotes mean an exact phrase; `OR` works. | Plain words, one search per title (quotes only with "Exact titles only"). |
| `location` | Signed out it works. Signed in, LinkedIn drops the text and keeps only `geoId`. | Always sent. |
| `geoId` | Works. It's LinkedIn's numeric id for a place. None found published for Beaverton. | Learned on a run: Claude sets the place in LinkedIn's box, the app reads `geoId` from the address and saves it on the search. |
| `distance` | LinkedIn's menu offers 5/10/25/50/100 miles. One Nov 2026 test saw no change in results when signed in. | Always sent with a place (default 25), rounded up to LinkedIn's options. Each run reports if it was dropped. |
| `f_TPR` | Works; `r86400` = 24 hours. | Kept as set (Today = `r86400`). |
| `sortBy=DD` | Disputed; signed in it's removed from the address. | Always sent; reported if dropped. Sorting matters little within 24 hours. |
| `start` | Only scraping guides mention `start=0,25,50…`. | `next_page_url` uses it. Step 8 tells Claude to use the page's own Next button if the link shows the same or no jobs. |
| `f_WT` | Signed in it applies. | Only sent when the search says remote only or no remote. |

## Decisions

- **One search per title, plain words.** It matches close variants, avoids
  how LinkedIn combines a long OR query, and gives a result count per title.
  That count shows when a title is too narrow.
- **Pages per search (default 2) × searches per run (default 6).** Both are
  user limits (010's Instructions page). A page with nothing new ends that
  search, not the run.
- **Low scores are per resume type and expire on rule changes.** A low score
  for one kind of role says nothing about another. It's also wrong once the
  rules that caused it (e.g. the degree rule) change.

## Sources

- [LinkedIn job search URL parameters that still work](https://iamdheeraj0211.github.io/earlyapply/linkedin-job-search-url-parameters.html) (tested Nov 2026)
- [How to Hack LinkedIn Job Search URLs for Better Results](https://www.trykondo.com/blog/linkedin-job-search-hacks)
- [LinkedIn job search scraping guide](https://glama.ai/mcp/servers/@adamd9/mcp-jobsearch/blob/2c861f861b5788f814153ef3ebfbe6f7c1ba6ef6/linkedin_job_search_scraping_guide.md)
- [Perform Jobs Search (Unipile)](https://developer.unipile.com/v2.0/reference/performclassicjobssearch) (distance values 5/10/25/50/100, needs a geo id)
