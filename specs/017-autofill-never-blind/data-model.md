# Data model: Autofill that never goes blind

## TaughtField (backend table `taught_fields`, per user, RLS)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | RLS: the owner only |
| `site` | text (≤ 255) | registrable host, plus the company path on shared hosts (same as `siteOf`) |
| `fingerprint` | jsonb (≤ 4 KB) | see Fingerprint below; validated server-side |
| `profile_key` | text, nullable | one of the profile keys (first_name, email, phone…) |
| `answer` | text (≤ 2000), nullable | a custom typed answer; exactly one of `profile_key` / `answer` is set |
| `use_count` | int, default 0 | |
| `last_used_at` | timestamptz, nullable | |
| `created_at`, `updated_at` | timestamptz | |

**Limits:**
- 50 per site and 500 per user. The oldest unused entry is dropped first.
- A new entry with the same `site` + matching fingerprint replaces the old one (re-teaching).

## Fingerprint (JSON, stored; never a CSS path as the key)

| Field | Meaning |
|---|---|
| `label` | normalized question text (≤ 120 characters) |
| `name`, `id`, `testid` | only if "word-like" (not auto-generated); ≤ 80 characters each |
| `autocomplete`, `aria`, `placeholder` | ≤ 80 characters each |
| `kind` | the scan kind (text, select, combobox, radio…) |
| `section` | the nearest heading or legend (≤ 80 characters) |
| `index` | position among the form's fields |
| `selector` | a finder-style selector, a **hint only** |

**Match score:**
- exact `name`/`id`/`testid`: 1.0
- the same label: 0.9
- autocomplete/aria/placeholder: 0.7
- kind, section and index: small boosts

The best match is accepted only if it scores ≥ 0.75 and beats the runner-up by ≥ 0.15.

## ScanReport (generated on demand, never stored)

```
{ version, host, frames: [ { frameId, host, found, kept, dropped: {reason: count},
    fields: [ { label≤80, kind, hints{autocomplete,name,id ≤40}, visible{size,checkVisibility,standIn,inModal,ariaHidden},
                decision: "profile:first_name" | "learned" | "taught" | "need:<reason>" | "skip:<reason>" } ] } ] }
```

There are no `value` fields anywhere. A unit test fills a page with the profile, builds the report, and asserts that no profile value is a substring of it.

## Panel trouble state

Every failure (`no_form`, `nothing_matched`, `refresh`, `slow`, `asleep`) renders the **Trouble bar**: Read the page again, Point at a box, Copy what Job Catcher saw.

`signed_out` shows sign-in instead.

## Pick session (in memory)

`{ tabId, frames: active, picked?: {frameId, fieldId, label, kind, options, fingerprint} }`

**States:**
- `idle` → `pointing` (the panel's button), then `picked` (a click on the page).
- From `picked`: `filled` (a choice), then saved and back to `pointing`, or `idle` (Done/Esc).
