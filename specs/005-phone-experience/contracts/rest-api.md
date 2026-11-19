# Contract: REST API

One endpoint, shared with 004. Everything else this feature needs already
exists.

## GET /v1/attention

Counts for the navigation badges. Same auth as the rest of `/v1`; scoped to the
signed-in user.

```json
{"tasks_open": 0, "tasks_overdue": 0, "email_review": 4}
```

- `email_review`: detected email events waiting on the user (pending or
  needs-answer on an important type) — the same set as the page's "To review".
- `tasks_open` / `tasks_overdue`: 0 until 004's to-dos exist; the shape is
  fixed now so the client doesn't change later.
- Cheap: `COUNT` queries only, no rows. The client asks on load, on window
  focus, after any email action, and at most every 60 s while visible.

## Used as they are

| Need | Endpoint |
|---|---|
| My Jobs rows, stage counts, search | `GET /v1/saved-jobs/` (already a light list: preview, no full description) |
| A job's full text on its page | `GET /v1/jobs/{id}` |
| Move a job | `POST /v1/pipeline-stages/move` |
| Email updates, actions, viewer | `/v1/email/*` as today (and 004's `view=` when it lands) |
| Scout searches, runs, resume types | `/v1/scout/*` as today |
