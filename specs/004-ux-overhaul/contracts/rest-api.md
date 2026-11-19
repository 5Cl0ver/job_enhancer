# Contract: REST API changes

All under `/v1`, same auth (Supabase bearer token), all scoped to the signed-in
user. Another user's id is a 404.

## To-dos

### GET /tasks?state=open|done
Open (default) or the last 30 days of done tasks.

```json
[{
  "id": "…", "kind": "assessment", "title": "Assessment to do",
  "due_at": null, "done_at": null, "created_at": "2026-11-19T18:02:00Z",
  "from_email": true,
  "job": {"saved_job_id": "…", "job_listing_id": "…", "title": "IT Administrator",
          "company": "Vellacor", "stage": "Take-Home Assignment"}
}]
```
Order: overdue, then dated (soonest first), then undated (newest first).

### POST /tasks
`{"saved_job_id", "title", "kind"="other", "due_at"=null}` → 201 task.

### PATCH /tasks/{id}
Any of `{"title", "due_at", "done": true|false}` → task.

### DELETE /tasks/{id}
204. An email-made task is kept as done so the same email can't re-create it.

## Attention counts (for the nav)

### GET /attention
`{"tasks_open": 2, "tasks_overdue": 0, "email_review": 4}` — three counts, one
round trip, polled every 60 s and refreshed after any action.

## Saved jobs

### GET /saved-jobs/
Each item gains:

```json
"open_tasks": [{"id": "…", "kind": "interview", "title": "Interview: reply and prepare", "due_at": null}]
```
and no longer carries the full description (the drawer fetches the one job it
opens). New saves get the user's first stage when none is given.

### POST /pipeline-stages/move
Unchanged. Now idempotent in the UI's eyes: moving a job to the stage it is
already in returns 200 with the job (covers a retried request whose first reply
was lost).

## Email updates

### GET /email/events?view=review|history|other&limit=50&offset=0
- `review`: pending + needs-answer (not paged; this is the work list).
- `history`: applied, auto-applied, dismissed; `acted_at` within 30 days;
  newest first. Each row adds `acted_at`, `acted_by` (`auto`|`user`) and
  `outcome` (`moved`|`dismissed`).
- `other`: confirmations, recruiter, not-saved, hidden; paged.

Response: `{"items": [...], "total": 132}`.

### POST /email/events/bulk
`{"ids": ["…"], "action": "apply"|"dismiss"}` → `{"done": ["…"], "failed": [{"id": "…", "reason": "…"}]}`.
One transaction per item; a failure doesn't undo the others and is reported.

### POST /email/scan/start
202 `{"state": "running"}`. 409 if one is running; 429 with `Retry-After` while
the mail server's slow-down is active. Replaces `POST /email/scan`.

### GET /email/scan/status
```json
{"state": "running", "started_at": "…", "checked": 350, "found": 6, "moved": 2,
 "folder": "Inbox", "message": null, "last_scan_at": "…"}
```
`state`: `idle` · `running` · `done` · `stopped`. Never contains senders,
subjects or text.

### mail_link (field on events and on the message view)
Gmail: exact message by Message-ID (unchanged). Yahoo/AOL: search for
`from:<sender address> subject:"<subject>"`. Others: null.

## Scout

### POST /scout/tracks/{id}/resume  (multipart `file`)
Uploads the file and attaches it to the resume type in one transaction →
`TrackOut`. Same type and size limits as `POST /ai/resumes`. On any failure
nothing is stored.
