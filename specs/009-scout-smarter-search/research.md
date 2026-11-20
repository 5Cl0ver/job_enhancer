# Research: Claude Scout finds better jobs (009)

Each decision below was checked against the code as it stands after 008
(`backend/app/services/scout_runs.py`, `scout_review.py`, `scout_tracks.py`,
`app/mcp_server.py`, `app/models/scout.py`, `app/models/resume_track.py`).

## R1. How Claude gets the resume: the existing `get_master_profile` tool

- **Decision**: The brief doesn't carry the resume. The playbook (and the
  brief's `next`) tells Claude to call `get_master_profile` once at the start
  of every run and score every job against it. The brief adds
  `resume_ready: bool` (an active resume with extracted text exists) so Claude
  and the page know whether there is one.
- **Rationale**: `get_master_profile` already returns the profile, saved
  answers and the active resume's text, through the user's own signed-in
  connector, and it already says to ground everything in it and invent
  nothing. Nothing new is stored (FR-003). The brief stays small and constant,
  which keeps the "brief doesn't grow" test (under 6,000 characters) meaningful.
- **Alternatives**: put the resume text in the brief (doubles the brief, and
  repeats it on a resumed chat); store a summary of the resume per run
  (stores resume data, which FR-003 forbids).

## R2. Where a broad search lives: a hidden "Anything I'd be good at" resume type

- **Decision**: `resume_tracks` gains `kind` (`"scoped"` by default,
  `"broad"`). Each user gets at most one broad track, made on first use, named
  "Anything I'd be good at", with empty lists. Lists, the 8-track limit and the
  Resume types page show scoped tracks only. A broad search is an ordinary
  mission pointing at that track.
- **Rationale**: Missions, runs, findings and 008's title passes all key on
  `track_id` (passes: NOT NULL). Reusing that key keeps every existing path
  (queue, brief, check_jobs, passes, review, History) working unchanged, which
  meets the Simplicity principle better than making `track_id` optional
  everywhere.
- **Consequence**: titles Claude passed over in broad searches are remembered
  for the broad track, so they're shared by all of the user's broad searches.
  A title that doesn't fit doesn't fit on any site, so this matches the
  intent. The spec's edge case is worded to match.
- **Alternatives**: a nullable `track_id` plus a `broad` flag on missions
  (touches the passes table, findings, review and every `criteria["track"]`
  read); a separate broad-search table (duplicates missions).

## R3. Choosing titles mid-run: a new connector tool `set_search_titles`

- **Decision**: A broad run's brief has no `start_urls` yet. It has
  `titles_tried`, the overrides and `resume_types`, and its `next` says: call
  `get_master_profile`, choose up to 8 titles, call `set_search_titles`. The
  app then:
  1. normalises the titles;
  2. drops Never titles, resting titles and duplicates;
  3. puts Always titles first and caps the list at 8;
  4. saves the result in `run.criteria["search_titles"]`;
  5. updates the title memory;
  6. returns the `start_urls` with the run's own filters.

  `search_titles(c)` returns these titles for a broad run, so `start_urls`,
  `page_url` and the Local companies searches all use them with no other
  change.
- **Rationale**: The app keeps control of the filters (Claude never builds a
  search link), and the memory is updated in one place.
- **Calling it again**: a second call in the same run (for example, Claude
  rethinks after page 1) replaces the titles only if no results page has been
  checked yet. Otherwise it returns the current titles and links unchanged, so
  the page count and title stats stay consistent.
- **Alternatives**: Claude sends its titles in `check_jobs` (too late: the
  link is already open); the app picks titles itself from the resume (needs an
  app-side AI call, against "let Claude do its thing").

## R4. One search link with up to 8 titles

- **Decision**: All of a run's titles go into one search link as quoted
  phrases joined with OR, the same pattern scoped searches use with 4.
- **Rationale**: Paging (008: up to 4 pages, `next_page_url`) and the "ran
  out" detection assume one results list per run. LinkedIn and Indeed accept
  OR between quoted phrases; ZipRecruiter and Google treat the query as
  keywords, as they already do for scoped searches.
- **Alternatives**: one link per title (multiplies pages and breaks the
  4-page budget); two links of 4 (needs per-link paging).

## R5. Which title found a job: the app matches it, Claude isn't asked

- **Decision**: When a finding becomes a good fit (picked or saved) on a broad
  run, the app gives it the searched title with the most words in common with
  the posting's title (normalised words; ties go to the earlier title). With no
  words in common it gets the first title. This is stored on
  `scout_findings.search_title` and counts as a good fit for that title in the
  memory.
- **Rationale**: The rule is predictable and testable, and costs Claude
  nothing extra. It's good enough to steer which titles are kept.
- **Alternatives**: ask Claude in `report_job` (one more thing for Claude to
  get wrong; it can't truly know which OR phrase matched).

## R6. Closest resume type: Claude names it in `report_job`

- **Decision**: `report_job` gains an optional `resume_type` (a name). The
  broad brief lists the user's resume types (name plus up to 4 titles each).
  The app matches the name without regard to case or spacing, against scoped
  tracks only, and stores the match on `scout_findings.closest_track_id`.
  Unknown names count as "none". Saving a broad finding tags the saved job with
  that track.
- **Rationale**: Unlike R5, this is a judgment of the whole posting against
  the user's tracks, which only Claude can make.

## R7. Title memory and rest

- **Decision**: New table `scout_titles`, one row per mission and normalised
  title: `runs`, `good_fits`, `last_tried_at`. "Resting" is computed, not
  stored: `runs >= 3 and good_fits == 0 and last_tried_at > now - 14 days`, and
  never for an Always title. `set_search_titles` adds 1 to `runs` for each
  title used, once per run. A new good fit adds 1 to its title's `good_fits`.
- **Rationale**: A computed state can't go stale, and the rule is easy to
  change later (010 makes the limits editable).

## R8. Overrides on the mission

- **Decision**: `scout_missions.overrides` (JSON, nullable):
  `{"always": [..], "never": [..], "avoid": [..]}`. Each list holds up to 20
  entries, each up to 80 characters. They're tidied (spaces collapsed) and
  de-duplicated without regard to case.
  - At queue time, Avoid words are merged into
    `criteria["track"]["skip"]["exclude"]`, so 008's `excluded` check and the
    "had a word you skip" count apply unchanged.
  - Overrides are snapshotted in the run's `criteria` at queue time
    (FR-017: a running run keeps its settings).
- **Rationale**: The overrides are per search (FR-015) and few, so a JSON
  field is enough; nothing queries inside them.

## R9. Default collection "Claude's picks"

- **Decision**: `scout_review.default_folder_name` returns "Claude's picks"
  when `criteria["broad"]` is true.

## R10. No resume

- **Decision**: `queue_run` returns 422 for a broad mission when the user has
  no active resume with text ("Upload your resume first: AI Apply → Your Resume").
  Scoped runs carry on, with `resume_ready: false` in the brief. The playbook
  then says to score against the resume type alone. The Start page shows a
  note with a link.

## R11. Instructions and versions

- **Decision**: `PLAYBOOK_VERSION` becomes `2026.11.6`.
  - New file `app/scout/broad.md` holds the broad steps. The brief carries it
    as `broad_steps` for broad runs.
  - `playbook.md` gains the "read the resume first" step and the "name a
    resume item in why it fits" rule.
  - All of the wording stays in version-controlled files (Constitution III).

## R12. Cost

- Claude in Chrome runs on the user's own Claude plan; the app makes no AI
  call of its own for this feature, so there's no new cost to show
  (Constitution III, transparency). Calling `get_master_profile` once adds the
  resume to each run's chat once.
