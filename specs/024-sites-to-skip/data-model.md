# Data model: Sites to skip

The migration `u9d0e1f2a3b5_skipped_sites` comes after `t8c9d0e1f2a4`. It is additive, and RLS is on for the new table.

## `skipped_sites`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | fk users, cascade, indexed | |
| `host` | str(255) | lowercase, no "www.", no path; for example `learn4good.com` |
| `created_at` | timestamptz | |

**Constraints:**
- Unique on (`user_id`, `host`).
- At most 100 rows per user (checked in the service).

**Rules:**
- A row is added from a pasted link or site name, and removed by id.
- Deleting the user deletes their rows (cascade).
- The data export lists the sites.
