# Data model: one checklist, edit while it fills, problems report

The migration `y3b4c5d6e7f9_apply_problems` comes after 029's `y3c5e7a9b1d2`. It is additive.

## `apply_runs.problems` (new, JSON, NOT NULL, default `[]`)

```json
[{"id": "3f9a1c0b2d", "at": "2026-11-25T10:07:30+00:00", "kind": "job_catcher",
  "what": "Job Catcher said no résumé box, but there is one",
  "page": "https://northwind.example/apply/2", "site": "northwind.example",
  "count": 2, "status": "open", "run_id": "…", "job": "IT Engineer at Northwind Labs",
  "job_catcher": "0.42.0", "playbook": "2026.11.30"}]
```

- `status`: open | fixed | ignored (the admin sets it; the same problem again is open again).

- `kind`: fill | job_catcher | tab | resume | site | other.
- `what` ≤ 500 chars, secrets removed; `page` without query or fragment (or null).
- At most 20 a run. Written only by `report_problem` (the run's own Claude).

## `apply_runs.questions[]` (existing, new optional fields)

```json
{"id": "a1b2c3d4e5", "question": "Years of Python?", "why": null,
 "guess": null, "choices": ["1", "2", "3+"], "only_you": true, "batch": 2,
 "answer": "3+", "skipped": false, "source": "app", "fact_id": "…"}
```

- `guess` ≤ 500 chars; `choices` ≤ 4, each ≤ 80; `batch` starts at 1 (old rows have none = 1).
- `from`: the run's status when the checklist began (filling, writing or reading): where it goes back to.
- `guessed`: the user left Claude's guess as it was; used for this run, no `fact_id`.
- ≤ 12 a batch, ≤ 30 a run. Starting a new batch marks the last one's unanswered questions skipped.

## `apply_runs.messages[]` (existing, new optional field)

```json
{"id": "…", "by": "you", "text": "Change it to “None”.",
 "at": "…", "read": false,
 "fix": {"box_on_page": "Prefix", "now_on_page": "Mr.", "to": "None"}}
```

- `text` is only the user's words. `box_on_page` / `now_on_page` are page text, from the live view (the box must be on it).
- `fix` has `to` (≤ 2000) and/or `ask` (≤ 500).
- At most 30 unread fixes at once.
