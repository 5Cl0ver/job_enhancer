# Data model: Apply with best judgment

The migration `w1f2a3b4c5d7_apply_live` comes after 025's `v0e1f2a3b4c6`. It is additive.

## `apply_runs.live` (new, JSON, nullable)

```json
{"url": "https://…/apply/myExperience", "title": "My Experience",
 "at": "2026-11-25T10:07:30Z",
 "boxes": [{"q": "First Name", "a": "Samuel", "by": "job_catcher"}, {"q": "How Did You Hear About Us?", "a": ""}]}
```

**Rules:**
- Written only by Job Catcher, for the owner's open run, while the status is `filling` or `needs_you`, for a page on the run's hosts.
- At most 150 boxes; `q` ≤ 300 chars; `a` ≤ 300 chars; `by` is "job_catcher" or absent.
- Questions that look like passwords, SSNs, card numbers or CVVs are dropped (the same rule as `_answers`, plus card/CVV).
- Set to null when the run leaves `filling`/`needs_you`, and when it ends.

## Page answers (existing `apply_runs.pages[].answers`)

These gain optional flags:

| Flag | Meaning |
|---|---|
| `claude: true` | Claude wrote it (exists) |
| `guess: true` | Claude's judgment, not a fact from the profile (new) |
| `agreement: true` | A box ticked to agree (new) |
| `by: "job_catcher"` | Job Catcher filled it; set by the server from the page's last fill result (new) |

## Review (existing `apply_runs.review`)

- Gains `fixes: [{page, q, a, to?, ask?}]` (≤ 30, text trimmed) on a `fix` decision from the bubbles.
- `note` is still required. The app composes it from the fixes.

## Request results (existing `apply_requests.result`)

- **fill:** gains `resume: "attached" | "no_box" | "no_file" | "failed"` (absent from old Job Catcher).
- **photo / peek:** `reason` gains `tab_closed`, `locked`, `hidden`, `changed` alongside the old `not_visible` / `error`.

## Help (existing `apply_runs.help`)

- `kind` gains `file`.
