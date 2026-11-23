# Contract: taught boxes API (all endpoints need a Bearer token; each user sees only their own entries)

## POST /v1/autofill/taught

Body:

```json
{ "site": "paycomonline.net", "fingerprint": { … }, "profile_key": "first_name" }
```

or, instead of `profile_key`, `"answer": "…"`.

- **201:** `{ "id": "…" }`
- **422:** both or neither of `profile_key` / `answer` is set, an unknown `profile_key`, or a fingerprint over 4 KB.
- **Re-teaching:** an entry with the same site and a matching fingerprint replaces the old one.

## GET /v1/autofill/taught

- **200:** `[ { "id", "site", "label", "profile_key" | "answer_preview" (first 40 characters), "use_count", "last_used_at" } ]`

## DELETE /v1/autofill/taught/{id}

- **204**, or **404** when it's not the caller's.

## GET /v1/autofill/bundle (spec 015, extended)

The response gains `taught: [ { site, fingerprint, profile_key | answer } ]`, and it's included in the version hash.
