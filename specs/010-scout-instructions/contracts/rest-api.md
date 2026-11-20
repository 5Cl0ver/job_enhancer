# REST API (web app ⇄ backend): 010

All routes are under `/v1/scout` and need a Bearer token. Each one only ever
shows or changes the signed-in user's own data; anything else returns 404.

## GET /instructions

```json
{
  "sections": [
    {"key": "playbook", "title": "Main steps", "kind": "text",
     "original": "…", "current": "…", "edited": true,
     "edited_at": "2026-11-21T10:00:00Z", "original_changed": false},
    {"key": "rubric", "title": "Scoring", "kind": "rubric",
     "original": {"skills": 4, "experience": 2, "title_level": 2, "recency": 1, "pay_location": 1},
     "current": {"…": 0}, "edited": false, "edited_at": null, "original_changed": false},
    {"key": "limits", "title": "Limits", "kind": "limits",
     "original": {"pages": 4, "titles": 8, "companies": 15}, "current": {"…": 0},
     "ranges": {"pages": [1, 8], "titles": [2, 8], "companies": [5, 25]}}
  ],
  "rubric_text": "Rubric (out of 10, judged against the resume): …",
  "fixed_limits": [{"label": "Titles that didn't fit are skipped for", "value": "30 days"}],
  "locked_rules": "…",
  "connector_note": "…server instructions…",
  "tools": [{"name": "check_jobs", "description": "…"}]
}
```

- The `sections` order is: `playbook`, `google_jobs`, `local_companies`,
  `broad`, `rubric`, `limits`.

## PUT /instructions/{key}

- Body: `{"text": "…"}` for text keys, or `{"values": {…}}` for `rubric` and
  `limits`.
- Returns the updated section.
- Returns 422 when the text is empty or over 8,000 characters, when the
  weights don't add up to 10, or when a limit is out of range. The `detail`
  says which.
- Returns 404 for an unknown key, including the locked rules.

## POST /instructions/{key}/reset

Returns the section, back to its original. The reset is recorded in history.

## GET /instructions/{key}/history

`[{id, created_at, reset, body}]`, newest first, at most 20.

## POST /instructions/{key}/restore/{version_id}

Makes that version current again as a new history entry, and returns the
section. Returns 404 if the version isn't the user's or belongs to another
key.

## GET /missions/{id}/preview

Returns the brief as Claude would get it if the search started now: the same
keys as `get_scout_brief`, with `run_id: null` and `"preview": true`. Nothing
is created.

## GET /runs/{id}/log

`[{id, created_at, tool, summary, ok, request, response}]`, oldest first.

## RunOut (changed)

`instructions: {key: edited_at or null} | null`. It's null for runs from
before 010.
