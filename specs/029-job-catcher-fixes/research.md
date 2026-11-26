# Research: Job Catcher fixes

## R1 - Why the master's history was used

`apply_resume.save_for_job` copied the master résumé's `parsed_history` (and its reading time) onto every résumé Claude wrote, so the run's résumé (correctly chosen by `applyRun.resumeFor` since spec 026) carried the master's details. The master's details came from its PDF text through `resume_reader._work`, which kept PDF line breaks, dropped short wrapped lines that started with a capital ("Application Insights.") into the "next job's name" buffer, needed a space after "•", and cut at 2,000 characters mid-word.

**Decision**: read a Claude résumé's details from its Markdown (`history_of_document`: `### ` sub-headings and the `> ` title line left out, then the same reader); on edit, read again. A résumé saved earlier is recognised by its details being stamped before it was made (borrowed) and is read again once (`refresh_borrowed`), on `GET /v1/autofill/resumes/{id}/details` and `POST /v1/ai/work-history`. Edited details are stamped later and kept.

**Reader**: every line under a job is kept as its description until the next job's dates line takes back the (at most two) lines above it that name the job. A line carries on the point before it when it starts lower-case, when the point doesn't end a sentence and ends in a joining word or comma, or when the line before ran to the page edge (≥ 75% of the longest line). "Omni-" + "channel" joins with no space. Bullet glyphs count with or without a space, and alone on a line. Output: one point per line, "• " kept, cut only between points (one huge point at a space).

Also in the extension: when the run's résumé can't be loaded, the copy's history is cleared (never the master's) and the work history is asked for by the run's résumé id.

## R2 - Why Workday's box was `no_box`

Reproduced on the lab page made to match the real DOM: the input's own label is "Upload a file (5MB max)", the nearby text is the same, it has no `accept` list and no id saying résumé, so `uploadKind` said "other". "Resume/CV" is only in the section heading. With the input beside the drop zone, the zone wasn't found either (`[data-automation-id*=upload]` is case-sensitive: "attachments-FileUpload").

**Decision**: `uploadZone` matches drop/upload names in any case (never "dropdown"), prefers the card's drop zone, and finds a drop zone beside the input. `uploadKind` then reads `area` (the smallest part of the page holding only this upload that names a document), the group title and the section heading; Workday's `file-upload-input-ref` with nothing else is "unclear" (the résumé when it's the page's only one). After setting the files, if Workday's zone (`file-upload-drop-zone`) doesn't show the file's name within 1.5 s, the file is dropped on it (dragenter, dragover, drop): only Workday's zone, only then.

## R3 - Stale steps

`session.report()` returned every box ever filled or left in the frame; Workday swaps steps in place, so step 1's boxes stayed. Claude's fill also read the stored session right after the press, before (or instead of, when Keep filling was busy) the new report landed.

**Decision**: the report lists only boxes still in the page and drawn (`checkVisibility`). The background's fill keeps only frames that reported after the press, waiting up to 3 s (20 s when Keep filling was already filling).

## R4 - Phone Extension

`profileKeyFor` matched "phone" in "Phone Extension" (and `type=tel`). **Decision**: a phone key is dropped for a box whose name/id/autocomplete says extension, or whose label says Ext/Extension without "number".

## R5 - Tab groups

Job Catcher never calls `tabs.create/move/group/ungroup` or `tabGroups` during a run. Its only tab change is `showFor` (photos): it made a background tab active without asking whether the user was busy when the window wasn't focused. Activating a tab doesn't change its group, so the split groups most likely came from the new tabs the apply links opened. **Decision**: `showFor` never switches tabs or restores a window while the user is active (15 s), in any window; the playbook keeps Claude in one tab.

## R6 - Learning

Reuses `custom_answers` (spec 018/020) with a new nullable `source` column ("claude"). The key is the extension's `normalizeQuestion`, so Job Catcher finds it by its usual exact/close match. Learning happens in `decide()` for submit/self; the questions the user changed (fix bubbles) are kept across review rounds in `review.changed`. A user save clears `source`.

## R7 - Review follow-up

- **Auto-save during a run**: `answersNoticed` / `profileNoticed` are ignored for a tab on the open run's site (`applyRun.inRun`). Reproduced in the e2e (a Prefix pick saved as `prefix: Dr.` before the fix).
- **Take-back**: `_takeable` never takes a line that ends a sentence (not "Inc.", "Co."), starts lower-case, or carries on the line above. A job named once on its dates line takes the next short line as its company (or title, by `_looks_like_title`). New points: a capitalised line after a full-width line still starts a point when it opens with a verb of work done; the width rule is 90%.
- **Old readings**: details now carry `reader: 2` (a reading) or `edited: true` (the user's). Unmarked details whose jobs equal the frozen pre-029 reader's output (`resume_reader_v1.work`) were never edited: their jobs are read again once; any other unmarked details are marked `edited`. Runs on details, work-history and the bundle (before its version check).
- **Double attach**: the press's general fill also attached the résumé to Workday's re-drawn empty box. Both the upload step and the general fill skip a résumé box while the résumé is up on this page and still shown. Reproduced with `apply-workday-steps.html?step=2&change` (4 copies before, 1 after).
- **Steps**: a new step = fewer than a third of the last step's question keys remain (never while a pop-up is open or with under 2 keys); a disconnected box is matched again by question key and kind.
- **Forgotten answers**: `users.forgotten_answers` (JSON list, ≤500, same migration): a delete adds the key, a user save removes it.

## R8 - Verification pass

- **No auto-save**: while ANY run is open (not only on its known sites: a redirect before the first fill isn't known yet), answers and profile are never auto-saved; an error counts as "in a run".
- **Drop check**: the card is read before the file is set. Taken = one more file than before, or our file's name newly shown, or the card re-drawn. A returning applicant's old file in the card never counts (unit test).
- **Company under the job line**: only text that reads like a name (capitalised words, joining words like "of" / "&" only between them, at most six words, no sentence end). Otherwise the company stays blank and the line is description.
- **Verb-like names**: a line opening like "Mentored…" is a new point only when the next word is lower-case (or a number) or the line has six or more words, so "United Rentals" and "Applied Materials" stay names.
