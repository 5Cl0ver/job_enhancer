# POST /v1/ai/autofill-map (extended, backward compatible)

## Request (unchanged)

```json
{ "fields": [{ "id": "f3", "label": "Years of experience with SQL?", "type": "select", "options": ["0-1", "2-4", "5+"] }] }
```

Only questions and options are sent, never page text or values. The rate limit stays at 20 per minute.

## Response (new key: `confidence`)

```json
{ "mappings": { "f3": "2-4" }, "confidence": { "f3": 0.82 } }
```

- `mappings` behaves exactly as before. Old extension builds ignore `confidence`.
- `confidence` is a number from 0 to 1 per mapped id. A missing value is treated as 0.5, so it becomes a suggestion only.
- The extension fills an answer when confidence is at least 0.75. Anything lower is shown as "Suggested: … [Use]".
- On an AI failure the response is `{ "mappings": {}, "confidence": {} }`, never a 5xx.
- The grounding is unchanged: profile, remembered answers and résumé text, and nothing invented.

## Tests

- A fake model reply in the new `{"f3": {"value": "2-4", "confidence": 0.82}}` shape parses.
- The old shape `{"f3": "2-4"}` still parses, with confidence 0.5.
- A value that isn't one of a select's options is dropped.
- A model error returns empty maps.
