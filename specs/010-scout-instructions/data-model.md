# Data Model: the Instructions page and the run log (010)

Migration `h6c7d8e9f0a2` (revises `g5b6c7d8e9f1`) adds two tables, each with
RLS enabled on Postgres. Nothing existing changes.

## scout_instruction_versions

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK users CASCADE | |
| `key` | String(20) | `playbook`, `google_jobs`, `local_companies`, `broad`, `rubric`, `limits` |
| `body` | Text, nullable | The edited text, or JSON for `rubric` / `limits`; null = reset to original |
| `base_hash` | String(16), nullable | Hash of the original this edit was made from |
| `created_at` | timestamptz | |

- Index on (`user_id`, `key`, `created_at`).
- The current version is the latest row per (`user_id`, `key`). No rows means
  the original.
- At most 20 rows are kept per (`user_id`, `key`); older ones are pruned on
  save.

**Validation**

- Texts: 1–8,000 characters after trimming.
- `rubric`: `{"skills", "experience", "title_level", "recency",
  "pay_location"}`, each a whole number 0–10, adding up to exactly 10.
- `limits`: `{"pages": 1–8, "titles": 2–8, "companies": 5–25}`.

## scout_run_events

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK users CASCADE | |
| `run_id` | UUID FK scout_runs CASCADE, indexed | |
| `tool` | String(40) | e.g. `check_jobs`, `get_master_profile` |
| `summary` | String(300) | A plain one-liner |
| `request` | JSON, nullable | What Claude sent, trimmed |
| `response` | JSON, nullable | The app's answer or `{"error": …}`, trimmed |
| `ok` | Boolean | False when the app refused the call |
| `created_at` | timestamptz | |

At most 400 rows per run; past that, one final "not logged" row is updated
with a count.

## scout_runs.criteria (new keys, set at queue time)

| Key | Meaning |
|---|---|
| `instructions` | `{key: {"edited_at": iso or null}}` for all six keys |
| `texts` | `{key: text}`, the edited texts only |
| `rubric` | The weights used |
| `limits` | `{"pages", "titles", "companies"}` used |

## API shapes

- `RunOut.instructions: {key: edited_at or null} | null`
- `InstructionSection`:
  - `key`, `title`, `kind` (`text`, `rubric` or `limits`)
  - `original`, `current`, `edited`, `edited_at`
  - `original_changed`
  - `ranges` (limits only)
- `InstructionVersion`: `id`, `created_at`, `reset`, `body`
- `RunEvent`: `id`, `created_at`, `tool`, `summary`, `ok`, `request`,
  `response`
