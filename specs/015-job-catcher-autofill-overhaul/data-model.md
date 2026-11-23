# Data model: Job Catcher overhaul (015)

## Server (Postgres)

### `resumes`: two new columns (migration `l0a1b2c3d4e6`, additive)

| Column | Type | Meaning |
|---|---|---|
| `parsed_history` | JSON, null | `{ "work": [WorkEntry], "education": [EducationEntry] }`, read once from this résumé |
| `parsed_history_at` | timestamptz, null | when it was read. Null means not read yet. Part of the bundle version. |

- **WorkEntry** has the same fields as today's `parse_work_history` output: `title`, `company`, `location`, `start_month`, `start_year`, `end_month`, `end_year`, `current`, `description`. Most recent first, at most 12.
- **EducationEntry**: `school`, `degree`, `field_of_study`, `start_year`, `end_year` (or graduation year). At most 6.
- Reading the résumé fails soft: on an AI failure, `parsed_history` is `{work:[], education:[]}` and `parsed_history_at` is set. A retry happens only when the résumé changes, or when the user asks through the existing work-history call.

No other tables change. `application_profiles` and `custom_answers` are unchanged.

### `scout_findings`

Unchanged. Save anyway creates the saved job through the existing `save_finding_job` path, using fallback fields instead of a capture.

## Extension: `chrome.storage.local`

### Autofill copy (`je_autofill`)

```text
{
  account: "<email>",              // copy belongs to this account; wiped if it differs
  version: "<server version>",
  fetched_at: <ms>,
  profile: {...ApplicationProfile},
  email: "...",
  answers: [{question_key, question_text, answer}],
  history: {work: [...], education: [...]} | null,
  history_pending: bool,
  resume: {id, filename, mime, parsed_at} | null
}
```

- `je_resume_bytes` holds `{id, b64}`. It is fetched again only when `resume.id` changes.
- The staged tailored résumé (`je_staged_resume`) is unchanged, and still wins over the active résumé.
- On sign-out, `je_autofill`, `je_resume_bytes` and `je_staged_resume` are removed along with the token keys.

## Extension: `chrome.storage.session` (per browser session)

### Fill session (`je_fill:<tabId>`)

```text
{
  site: "<registrable domain of the press>",
  keep_filling: true,
  frames: {
    "<frameId>": {
      url, step: "<fingerprint>",
      entries: [Entry],
      need_you: [{id, label, reason}],      // reason: no_data | no_option | rejected | sensitive_left | essay
      suggestions: [{id, label, value, options?}],
      ai_asked: ["<fingerprint>", ...]
    }
  },
  pending_answers: [{question_key, question_text, answer}]
}
```

**Entry**: `{id, label, kind, source: profile|learned|rule|ai, value, options?, can_undo: bool}`.

The previous value used by Undo stays **in the frame** (DOM snapshot, keyed by entry id) and is never stored. The session in storage only says whether Undo is possible.

### Transitions

- The session is created on the first press in a tab and updated after every fill, fix, undo or new step.
- Navigating away from `site` ends keep-filling. The session is removed when the tab closes.
- `pending_answers` entries are removed when saved or dismissed in the panel.

## Engine types (in memory, `extension/src/autofill/`)

- **Field**:
  - `{id, root, el | els, kind, question, question_key, hints {autocomplete, name, id, type, placeholder}, options?, required, section?, frame}`
  - `kind` is one of: text, textarea, editable, select, combobox, radio, checkbox_list, buttons, date, month_year, file
- **Decision**: `{value, source, confidence}` or `{skip: reason}`.
- **WriteResult**: `{ok, actual}`. A field is filled only if `ok` and the read-back matches.
