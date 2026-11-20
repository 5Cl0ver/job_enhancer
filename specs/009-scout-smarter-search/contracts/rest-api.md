# REST API (web app ⇄ backend): changes in 009

All routes are under `/v1/scout` and require a Bearer token. Every one is
scoped to the signed-in user, and anything else returns 404.

## POST /missions, PATCH /missions/{id} (changed)

The request body adds:

```json
{
  "broad": true,
  "overrides": {"always": ["IT Systems Administrator"],
                "never": ["Help Desk Technician"],
                "avoid": ["sales", "call center"]}
}
```

- `broad: true` lets `track_id` be left out, or ignores it. The search uses
  the user's "Anything I'd be good at" track, which is created if needed.
- `broad: false` (the default) needs `track_id`, as today.
- `overrides`: each list holds up to 20 entries of up to 80 characters
  (422 past that). They're tidied and de-duplicated without regard to case.
  Null clears them.
- `MissionOut` adds `broad: bool` and `overrides`.

## POST /missions/{id}/runs (changed)

- A broad mission with no active resume text returns 422, with detail
  "Upload your resume first: Profile → Resumes."

## GET /missions/{id}/titles (new)

Broad missions only (any other mission returns 404).

```json
[{"title": "Microsoft 365 Administrator", "runs": 2, "good_fits": 3,
  "last_tried_at": "2026-11-21T14:02:00Z", "resting": false,
  "always": false, "never": false}]
```

Sorted by good fits, then most recently tried.

## GET /runs, GET /runs/{id} (changed)

- `RunOut` adds `broad: bool` and `titles: [{title, good_fits}]` (empty for
  scoped runs).
- `FindingOut` adds `closest_track_name: str | null`.

## GET /tracks (changed)

- Returns scoped resume types only. The broad track never appears, and
  PATCH or DELETE on it returns 404.

## Unchanged routes the page uses for the one-tap actions

- **Pin or block a title:** `PATCH /missions/{id}` with updated `overrides`.
- **Add a title to a resume type:** `PATCH /tracks/{id}` with the title added
  to `target_titles`. This also clears that track's 008 title passes, which is
  wanted: the titles changed.
