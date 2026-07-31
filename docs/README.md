# Documentation — Start Here

How Job Enhancer is documented, and where to look for what. Written so **you**
*and* **an AI assistant** can get oriented fast without reading all the code.

## The golden rule: code is the source of truth

The **code + tests are always right**; git is the history. These docs are a
**map**, not a copy of the territory. So they only describe things that are
**stable and connective** — concepts, flows, how sections connect — and they
**link into the code** for exact details. We never mirror code line-by-line in
prose (that's what rots).

> **Altitude test before writing docs:** Is this a *concept, flow, or role*
> (stable) or an *implementation detail* (changes constantly)? Document the
> former; let the code speak for the latter.

## Where to look

| I want to know… | Read |
|---|---|
| **What the app does** (features + status) | [FEATURES.md](FEATURES.md) |
| **How it all fits together + why** (flows, auth, patterns) | [architecture.md](architecture.md) |
| **How the job-data engine scales** (multi-source + caching) | [job-data-architecture.md](job-data-architecture.md) |
| **What's inside a specific folder** | that folder's `MANIFEST.md` |
| **Exactly how something works** | the code + its tests |

## The `MANIFEST.md` convention

Every meaningful code folder has a `MANIFEST.md` — a **local map** of that folder:
what each file does (one line) and **how the folder connects to others**. Current
manifests:

**Frontend** — `src/` *(overview)*, `src/routes/`, `src/components/`, `src/hooks/`, `src/lib/`
**Backend** — `app/` *(overview)*, `app/api/`, `app/services/`, `app/models/`, `app/schemas/`, `app/middleware/`

Start with the `src/` and `app/` **overview** manifests — they map the loose
top-level files (`main.tsx`/`router.tsx`, `main.py`/`config.py`/`database.py`)
and how the subfolders fit together — then drill into a specific folder's manifest.

*(A folder-level manifest can cover its subfolders; e.g. `services/MANIFEST.md`
mentions the `sources/` adapter registry.)*

## The one habit that keeps this alive

When you **add, rename, or repurpose a file**, update that folder's `MANIFEST.md`
line for it. When you change a **flow or a design decision**, update
`architecture.md`. That's it — because everything is at role/flow altitude,
these edits are one or two lines, not rewrites.

## Doc map

```
docs/
├── README.md                   ← you are here (index + conventions)
├── FEATURES.md                 ← product view: every feature + status + files
├── architecture.md             ← mental model: flows, auth, patterns, "why"
└── job-data-architecture.md    ← deep dive: multi-source ingestion + caching

<each code folder>/MANIFEST.md  ← local map of that folder
```
