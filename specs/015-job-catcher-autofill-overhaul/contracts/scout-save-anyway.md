# POST /v1/scout/findings/{finding_id}/save: `anyway`

## Request

```json
{ "collection_id": null, "new_collection_name": null, "anyway": true }
```

`anyway` defaults to `false`. With `false`, behavior is exactly as today: a 409 with the "not copied" reason when there's no copy.

## Behavior when `anyway: true` and the page wasn't copied

- The job is saved from the finding's own fields: title, company, location (or "Not specified") and the posting link. The description is empty, the origin is Scout, and it goes in the same folder as other Scout saves.
- The listing counts as **needs details**. When the user next opens the posting with Job Catcher running, the existing passive backfill adds the full text.
- The response is the same `SaveFindingOut`. A duplicate of an already-saved job answers `already: true`.
- Allowed only for findings in `SAVEABLE ∪ {no_copy, waiting_for_copy}`. A rejected link, or a finding of another user, keeps today's 404/409.

## Frontend

On a Results card where `status === "new" && !can_save`, a **Save anyway** button sits next to "Open and press Save". It toasts "Saved to My Jobs › Folder. The full posting is added when you open it."

## Tests

- **pytest**:
  - Save anyway on a no_copy finding creates a thin saved job that is marked needs details.
  - Without `anyway`, the answer is still 409.
  - Another user's finding gives 404.
  - Saving twice answers `already`.
- **Vitest**: the button shows only when `!can_save`, calls the API with `anyway: true`, and toasts.
