# GET /v1/autofill/bundle

This returns everything the extension's autofill copy holds, behind a cheap change check. It requires a Bearer token and returns only the caller's own data.

## Request

`GET /v1/autofill/bundle?version=<last version>`. Omit `version` on the first call.

## Responses

**200, unchanged:**

```json
{ "changed": false, "version": "a1b2c3" }
```

**200, changed:**

```json
{
  "changed": true,
  "version": "d4e5f6",
  "email": "wren@example.com",
  "profile": { "first_name": "Wren", "last_name": "Calloway", "phone": "555-010-4477", "city": "Harborview", "state": "OR", "country": "United States", "authorized_to_work": true, "requires_sponsorship": false, "willing_to_relocate": true, "...": "all ApplicationProfile fields, null when unset" },
  "answers": [{ "question_key": "how did you hear about us", "question_text": "How did you hear about us?", "answer": "LinkedIn" }],
  "history": { "work": [{ "title": "Support Engineer", "company": "Tidewell Labs", "location": "Harborview, OR", "start_month": 3, "start_year": 2023, "end_month": null, "end_year": null, "current": true, "description": "…" }], "education": [{ "school": "Harborview Community College", "degree": "Associate", "field_of_study": "Computer Science", "start_year": 2019, "end_year": 2021 }] },
  "history_pending": false,
  "resume": { "id": "uuid", "filename": "wren.pdf", "mime": "application/pdf", "parsed_at": "2026-11-23T08:00:00Z" }
}
```

- **PR C ships the bundle without history** (`history: null`, `history_pending: false`); PR D adds the stored résumé reading.
- `history` is `null` with `history_pending: true` while the résumé is being read. The server starts reading it in the background, and the next change check returns the result.
- `resume` is `null` when there is no active résumé. The bytes still come from the existing `GET /v1/ai/resumes/active/file`.
- **401** means not signed in. The extension wipes its copy.

## Version

The version is a short hash of:
- `users.email`
- `application_profiles.updated_at`
- `(count, max(updated_at))` of `custom_answers`
- the active résumé's `id` and `parsed_history_at`

Computing it reads only those few values. The full bundle is built only when the version differs.

## Tests (pytest)

- The first call returns the full bundle.
- Passing the returned version gives `changed:false`.
- Editing the profile, adding an answer, or a new résumé or reading each changes the version.
- Another user's data is never included.
- A missing reading starts exactly one background read and returns `history_pending`.
- 401 without a token.
