# REST contract: Bug inbox (032)

All `/v1/admin/bugs*` routes need the owner (`AdminUser`), and anyone else gets 403. Field names follow [data-model.md](../data-model.md).

## List

`GET /v1/admin/bugs`

Query (all optional):
- `type`: `bug` (default) or `idea`
- `section`, `severity`, `source`
- `status`: a status, or `open` (default for bugs: new, confirmed, working) or `all`
- `came_back`, `needs_check`: bool
- `q`: search title, place, box and actual
- `limit` (≤ 200, default 100), `offset`

Returns `200`:
```json
{
  "items": [{ "id", "type", "title", "section", "severity", "status", "source",
              "count", "first_seen", "last_seen", "came_back_at", "needs_check",
              "fixed_in", "pinned", "place", "has_shot" }],
  "total": 12,
  "counts": { "bugs_open": 9, "ideas_open": 3,
              "sections": { "app": 2, "job_catcher": 4, "...": 0 } }
}
```

Items are in priority order (research R5). Merged-away reports never show.

## Detail

`GET /v1/admin/bugs/{id}` returns `200` with the full report, plus:
- `events`: newest first, at most 100;
- `links`: `[{id, title, type, status}]`;
- `shots`: `[{id, size}]`;
- `run`: `{id}` or null;
- `job`: `{id, title, company}` or null.

Returns `404` if the report is missing or merged away.

## Create (owner)

`POST /v1/admin/bugs`, also allowed with the Job Catcher pass when its user is the owner (`require_admin_or_pass`).

Body:
```json
{ "type": "bug", "title": "…", "section": "app", "place": "/jobs/:id", "box": null,
  "steps": ["…"], "actual": "…", "expected": "…", "severity": "major",
  "confidence": "sure", "context": { "device": "phone", "browser": "Chrome 131",
  "theme": "dark", "app_version": "a1b2c3d", "job_catcher": "0.44.0" },
  "source": "owner" }
```

Returns `201`: `{ "report": {…detail}, "similar": [{id, title, status, score}] }`. `similar` holds up to 3 suggestions (research R3).

## Change

`PATCH /v1/admin/bugs/{id}`

Body (any of): `title`, `section`, `place`, `box`, `steps`, `actual`, `expected`, `severity`, `confidence`, `type`, `status`, `fixed_in`, `pinned`, `checked` (true clears `needs_check`).

Returns `200` with the detail. Each changed field adds an `edit` or `status` event (by `owner`).

`POST /v1/admin/bugs/bulk`

Body: `{ "ids": [...≤100], "status"?: "...", "section"?: "..." }`

Returns `200`: `{ "changed": n }`.

`DELETE /v1/admin/bugs/{id}` returns `204`, and its events, links and shots go with it.

## Notes, links, merge

- `POST /v1/admin/bugs/{id}/notes` with `{ "text": "…≤1000" }` returns `201` and the event.
- `POST /v1/admin/bugs/{id}/links` with `{ "other_id" }` returns `201`. `DELETE /v1/admin/bugs/{id}/links/{other_id}` returns `204`.
- `POST /v1/admin/bugs/{id}/merge` with `{ "into_id" }` returns `200` and the target's detail. Merging into itself, or into a report that is already merged away, is a 400.
- `POST /v1/admin/bugs/{id}/split/{event_id}` returns `200` and the restored report's detail.

## Screenshots

- `POST /v1/admin/bugs/{id}/shots`: raw body `image/jpeg`, `image/png` or `image/webp`, ≤ 1 MB, magic bytes checked, at most 3. Returns `201` with `{id, size}`, or `413` / `415` / `409` (already 3). It also takes the Job Catcher pass for the owner.
- `GET /v1/admin/bugs/shots/{shot_id}` returns the bytes with their type and `Cache-Control: private, no-store`.

## Caught errors (any signed-in user, or a Job Catcher pass)

`POST /v1/bugs/caught`, rate-limited to 20 per minute per user.

Body:
```json
{ "section": "app|job_catcher", "kind": "crash|save_failed|resume_failed|fill_failed",
  "place": "…", "message": "…≤300", "context": { … } }
```

Returns `202` with `{ "kept": true }`, or `{ "kept": false }` once the hourly cap is hit. It never returns the report and never says who else hit it. The message is scrubbed, and the user is never stored.

## Attention

`GET /v1/attention` adds `bugs_new`: the number of new bugs for the owner, and 0 for anyone else.

## Removed

`GET /v1/admin/apply-problems` and `PATCH /v1/admin/apply-problems/{run_id}/{problem_id}` are replaced by the routes above (research R10).
