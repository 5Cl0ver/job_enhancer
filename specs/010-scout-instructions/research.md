# Research: the Instructions page and the run log (010)

Each decision below was checked against the code after 009
(`services/scout_runs.py`, `scout_titles.py`, `scout_companies.py`,
`app/mcp_server.py`, `app/scout/*.md`).

## R1. Where edits live: one versions table

- **Decision**: New table `scout_instruction_versions`. Each row holds the
  user, a `key`, a `body`, `created_at` and `base_hash`.
  - Keys: `playbook`, `google_jobs`, `local_companies`, `broad`, `rubric`,
    `limits`.
  - `body` is the text, or JSON for `rubric` and `limits`. A null `body`
    means "reset to original".
  - `base_hash` is a short hash of the original the edit was made from.
  - The latest row per key is the current version. Saving prunes all but the
    latest 20 per key.
- **Rationale**: One table gives Save, Reset, history and Restore for every
  section the same way. A reset is a row too, so it shows in history.
- **Alternatives**: a settings JSON column on users (no history); one table
  per kind (more code for the same behaviour).

## R2. Locked rules: moved out of the playbook, always appended

- **Decision**: The always-apply rules move from `playbook.md` (steps 8–9 and
  the job-text line in step 4) into a new `app/scout/rules.md`.
  - The scoring line is no longer in the playbook text. The app writes it
    from the weights (`rubric_text`).
  - The brief's `playbook` becomes the user's main steps, then the scoring
    line, then the locked rules, in that order.
  - Only `playbook` and the three extra-step keys are editable texts.
    `rules.md` has no key, so nothing can change it.
- **Rationale**: FR-006 / SC-003: no edit can remove the rules, because the
  app adds them after whatever the user wrote.

## R3. A run keeps its instructions: snapshot in `criteria`

- **Decision**: `queue_run` stores the following in `criteria`:
  - `instructions`: `{key: {"edited_at": iso|None}}` for every key
  - `texts`: the edited texts only (originals are read from the code)
  - `rubric` and `limits`: the resolved values

  `brief` reads from the snapshot, so a new chat mid-run gets the same
  instructions. `RunOut.instructions` shows which sections were edited and
  when.
- **Rationale**: Pruning history can't break a run, because the run carries
  its own copy, at most 4 × 8,000 characters. The originals come from the
  code at brief time.
- **Alternatives**: referencing version ids (a pruned version breaks a queued
  run).

## R4. Editable limits read from the run

- **Decision**: `criteria["limits"] = {"pages", "titles", "companies"}`. The
  ranges are 1–8, 2–8 and 5–25, and the defaults are the current constants
  (4, 8, 15).
  - Pages: `check_jobs`, `run_tip` and the brief's `max_pages`.
  - Titles: `scout_titles.choose` and the brief's `max_titles`.
  - Companies: `scout_companies.check` and its `counts`.

  Older runs without `limits` fall back to the constants. The other limits
  stay constants and are shown read-only: title passes 30 days, resting 3
  runs / 14 days, re-checks 7 days / 3 a run.

## R5. Rubric weights

- **Decision**: The rubric has five fixed parts (`skills`, `experience`,
  `title_level`, `recency`, `pay_location`). Each weight is a whole number
  from 0 to 10, and they must add up to 10. `rubric_text` is written from the
  weights with the existing labels and the honesty sentence.

## R6. The run log: written by the connector tools

- **Decision**: New table `scout_run_events`. Each row holds `user_id`,
  `run_id` (FK CASCADE, indexed), `created_at`, `tool`, `summary`
  (≤300 characters), `request` (JSON), `response` (JSON) and `ok`.
  - A helper in `mcp_server.py` wraps each Scout tool: it runs the service,
    then records the event in the same session. On a `ValueError` it rolls
    back, records `ok=false` with the message, commits, and re-raises.
  - Logging never fails a tool: any error while logging is swallowed and
    logged to the server log.
  - Summaries are plain sentences, made per tool by `scout_log.summarize`.
  - **Trimming**:
    - The brief's response is stored without `playbook`, `source_steps` and
      `broad_steps`, which are replaced by references like `"main steps
      (edited Nov 21)"`.
    - Any request or response over 8,000 characters as JSON is stored as
      `{"trimmed": "<first 8,000 characters>"}`.
    - At most 400 events per run; later ones are counted in a final "N more
      calls not logged" entry.
  - `get_master_profile` adds an event ("Read your resume — not stored") to
    the user's running run, if any, with no content.
- **Rationale**: The service layer stays as it is, and the log sees exactly
  what crossed the connector, including refusals.

## R7. Preview without side effects

- **Decision**: `scout_runs.preview(db, user_id, mission_id)` builds the same
  `criteria` as `queue_run` (shared `_criteria`) and an unsaved `ScoutRun`,
  then returns the same brief body (shared `_brief_body`).
  - Local companies re-checks aren't chosen in a preview, because choosing
    them marks them as handed out. The preview says "re-checks are chosen
    when the run starts".
  - No rows are written.

## R8. Tool descriptions on the page

- **Decision**: The page reads them from the connector code itself: the
  server's `instructions` and `inspect.getdoc` of each Scout tool function.
  That way the page can never disagree with what Claude sees.
- **App replies**: they're dynamic, so the page explains them and points to
  each run's Log, which shows every reply verbatim (FR-007).

## R9. "The original changed since you edited this"

- **Decision**: `base_hash` is the first 16 characters of the sha256 of the
  original at save time. The page compares it with the current original's
  hash and shows the note, plus the original, for comparison.

## R10. Security

- Every route and table is scoped to the user (404 otherwise), with RLS on
  both new tables.
- Bodies are limited in length and checked by schema.
- The page renders everything as text: React escapes it, and there's no
  `dangerouslySetInnerHTML`.
- Locked rules have no route that writes them.
