# Job-Data Architecture — Multi-Source Aggregation + Caching

**Status:** design sketch (not yet built) · **Date:** 2026-07-29
**Goal:** broad, fresh, real job listings for many users on **$0** free tiers,
without scraping walled gardens (Indeed/LinkedIn/Glassdoor) server-side.

---

## 1. The problem

Today, `GET /jobs/?q=…` does everything **inside the request**:

```
User types "engineer"
      │
      ▼
FastAPI  ──▶ call Adzuna   (live)
         ──▶ call JSearch  (live)
         ──▶ parse + dedup + insert
         ──▶ query DB, return page
      │
      ▼  (3+ seconds, and burns a quota call PER search)
Results
```

Why this breaks for real users:
- **Quota burn:** every keystroke-driven search spends external API calls. JSearch free = **200/month total** — a handful of users exhaust it in a day.
- **Latency:** users wait on live third-party round-trips (>3s).
- **Coverage:** only sources we can call *synchronously* and *cheaply*.
- **Fragility:** if a source is slow/down, the user's search is slow/down.

## 2. The target: separate **ingestion** from **search**

Decouple "getting jobs into our database" (background, scheduled) from "users
searching" (instant, reads our DB only).

```
        ┌──────────────────────── INGESTION (background, scheduled) ─────────────────────────┐
        │                                                                                     │
  Scheduler / triggers            Source adapters (pluggable)         Normalize → Dedup → Upsert
        │                          ┌───────────────────────┐                    │
  • curated seed queries  ───────▶ │ Adzuna   (250/day)    │ ──┐                 ▼
  • users' saved searches ───────▶ │ Jooble                │   │        ┌──────────────────┐
  • "deep search" on cache-miss ─▶ │ The Muse              │   ├──────▶ │  job_listings     │  (shared pool,
  • HN "Who's Hiring" parser  ───▶ │ USAJobs               │   │        │  deduped, 1 row   │   already exists)
  • browser extension captures ──▶ │ Remotive/RemoteOK/…   │   │        │  per real job)    │
                                   │ JSearch (200/mo, rare)│ ──┘        └──────────────────┘
                                   └───────────────────────┘                    │
        └─────────────────────────────────────────────────────────────────────┼───────────┘
                                                                                 │
        ┌──────────────────────────── SEARCH (per request, instant) ────────────▼───────────┐
        │  User types "engineer" ──▶ FastAPI queries job_listings ONLY ──▶ results (<300ms)  │
        └──────────────────────────────────────────────────────────────────────────────────┘
```

**Users always read our DB.** External APIs are only touched by background
ingestion. Result: fast searches, quotas spent deliberately (not per keystroke),
and coverage grows just by adding adapters.

## 3. Source-adapter pattern (the extensibility unlock)

Every source implements the same tiny contract, so adding a board is ~1 file:

```python
class JobSource(Protocol):
    name: str                      # "adzuna", "jooble", "hn_whoishiring", …
    async def fetch(self, query: str, location: str | None, page: int
                    ) -> list[dict]:      # raw source payloads
        ...
    def parse(self, raw: dict) -> NormalizedJob | None:   # → internal shape
        ...
```

- A registry lists enabled adapters; ingestion loops over them.
- `parse()` maps each source's fields into our normalized shape (title, company,
  location, salary, apply_url, posted_at, source, external_id).
- Everything then flows through the **existing** `dedup.py` + `_upsert_listing`,
  so one real job = one row regardless of how many boards surfaced it.
- **Refactor note:** today's `job_search.py` has Adzuna/JSearch fetch+parse
  inlined. Step 1 is to extract each into an adapter behind this Protocol.

## 4. What triggers ingestion

| Trigger | Cadence | Purpose | Quota use |
|---|---|---|---|
| **Curated seed queries** (e.g. "software engineer", "data analyst" × top locations) | daily | keep the DB broadly populated | Adzuna-heavy (cheap) |
| **Users' saved searches** | daily | powers the "New Matches" feed (FR-024) | spread across free sources |
| **On-demand "deep search"** | user clicks, rate-limited + cached | fill gaps when a query has thin DB results | JSearch (rare) |
| **HN "Who's Hiring" parser** | monthly (thread drops 1st of month) | unique startup jobs | free (HN Algolia API) |
| **Browser extension capture** | user-initiated | walled-garden jobs (LinkedIn/Indeed) | free, legal |

## 5. Quota strategy (how $0 actually scales)

- **Adzuna = workhorse.** Free tier is **250 requests/day (~7,500/mo)** — plenty for daily scheduled ingestion across many queries.
- **Jooble / The Muse / USAJobs / remote boards = free breadth**, no meaningful caps for our scale.
- **JSearch = premium/rare.** 200/mo reserved for scheduled *broad* pulls or occasional user "deep search," never per-keystroke.
- **Cache-first:** a search hits the DB; only a deliberate "search everywhere / refresh" button (rate-limited) may trigger live ingestion.

## 6. Freshness & quality

- `job_listings.refreshed_at` / `is_expired`; a daily job re-checks and marks stale listings expired (partially built). Expired jobs stay for tracking but are filtered from search.
- **Dedup is the differentiator** — lean into "every job once, no reposts/ghosts."
- **Source transparency (UI):** show "searched 5 boards · merged 12 duplicates" so users trust coverage.

## 7. Legal stance (deliberate, portfolio-relevant)

- ✅ Aggregate **official free APIs** (Adzuna, Jooble, Muse, USAJobs, remote boards, HN).
- ✅ Walled gardens (Indeed/LinkedIn/Glassdoor) via **user-initiated browser-extension capture** of publicly-shown data.
- ❌ **No server-side scraping** of Indeed/LinkedIn/Glassdoor — their ToS forbid it, it gets blocked, carries legal risk, and signals poor judgment to reviewers.

## 8. Rollout plan

1. **Extract adapters** — refactor Adzuna + JSearch in `job_search.py` behind the `JobSource` Protocol (no behavior change).
2. **Add free sources** — Jooble, The Muse, USAJobs, one remote board — each a new adapter; all flow through existing dedup.
3. **Flip search to cache-first** — `GET /jobs` reads `job_listings` only; add a scheduled ingestion job (curated queries + saved searches). Add a rate-limited "refresh/deep search" trigger.
4. **HN "Who's Hiring" adapter** — monthly parse via HN Algolia API (signature unique source).
5. **Source transparency** — surface which sources ran + dedup count in the search response/UI.
6. **Extension (later phase)** — capture channel feeds the same `job_listings` pool + tracker.

## 9. Touchpoints (mostly already in place)

- **`job_listings`** is already a *shared, deduped* pool (not per-user) — exactly what this design needs. ✅
- **`dedup.py`** already merges across sources. ✅
- **APScheduler** already runs in `main.py` — add the ingestion job there. ✅
- **Saved searches** already exist to drive per-user ingestion + the matches feed. ✅

The core data model already fits; this is mostly *reorganizing when the fetching
happens* (background vs request) and *making sources pluggable*.
