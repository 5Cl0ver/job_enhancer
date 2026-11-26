# Research: 020 Autofill that learns everywhere

**Sources:**
- A full code survey (2026-11-24).
- Live checks against production data, read-only.
- Online research into four working open-source autofill tools (job_app_filler, workday-autofill, Application Lane, AIHawk forks), Simplify's help pages, Workday docs, react-select source, and the LinkedIn/ILR/CEFR scales. URLs are inline.

## Root causes found

1. **The free AI has been dead since 2026-11-05.**
   - `NVIDIA_MODEL` defaults to `meta/llama-3.2-11b-vision-instruct`, which now returns **410 Gone** ("reached its end of life on 2026-11-05").
   - Every résumé read, cover letter and Autofill AI pass has failed silently since then.
   - The owner's active résumé has `parsed_history_at = NULL`, with 0 jobs and 0 schools. That's why job sections had nothing to fill.
2. **Learning is site-scoped by design.**
   - A pointer save (`background.entry.js` `picked` → `saveTaught({site,…})`) writes a `taught_fields` row for one site only.
   - `resolve()` checks the **profile before learned answers**, so a general learned answer could never beat the profile anyway.
3. **Wording.** "preferred name" vs "preferred first name" has a word overlap (Jaccard) of 0.67, under the 0.72 cutoff, so they never matched as one question.
4. **Owner's taught rows (read-only peek):**

   | Site | Label | Answer |
   |---|---|---|
   | talemetry | "preferred name" | Sam |
   | greenhouse/affirm | "preferred name" | Sam |
   | successfactors | "preferred first name" | Sam |
   | latticesemi Workday | **"first name"** | Sam |

   The Workday one is Workday's *Preferred Name* block, whose boxes are labelled plainly "First Name". Promoting it naively would put Sam into every legal first-name box.
5. **Workday Work Experience:**
   - `workday.js` already fills it and presses Add.
   - It is skipped on automatic steps once Workday pre-filled the rows (`workExperienceTouched`), never corrects pre-filled values, and records nothing for Undo.
   - With an empty history there was nothing to fill anyway.

## R1. No AI in 020 (replaces "Replacement free AI model")

**Decision (2026-11-24, the owner):** no AI in this feature. The model and config are left as they are; the retired model is fixed in the later AI phase. Résumés are read only by the built-in reader (R2), and Autofill's AI pass is switched off with one flag (`extension/src/autofill/flags.js`, `AI_IN_AUTOFILL = false`); the server endpoints stay.

**Earlier proposal, not done:**
- Default `NVIDIA_MODEL = minimaxai/minimax-m3.1-flash`. It was tested live: clean JSON from a sample résumé in about 5 s.
- Add an ordered **fallback list**: `nvidia/nemotron-3.5-super-vl-120b-a12b`, then `nvidia/nemotron-3.5-lightning-30b-a3b` (reasoning; needs a larger `max_tokens`).
- The service tries the next model on 404 or 410, and logs once.
- Strip `<think>…</think>` and similar reasoning text before reading JSON.

**Rationale**: models on the free catalogue get retired. A chain keeps the app working without a code change next time.

**Rejected**:
- `gemma-3-12b`: 404 for this account.
- `gemma-4-31b`, `glm-5.3-flash`, `mistral-large-4`: timed out at 90 s.

## R2. Built-in résumé reader (no AI)

**Decision**:
- A deterministic parser in the backend is the ONLY reader (no AI in 020).
- It splits text by section headings (Experience/Work History/Employment, Education, Skills, Certifications, Languages, Links).
- For jobs, it reads lines shaped like:
  - `Title | Company | Mon YYYY - Mon YYYY|Present`
  - `Title · Company   Mon YYYY – Present`
  - `Company — Title`, plus a date line
  
  Bullets become the description.
- Skills are split on commas, `|`, `·` and `;`.

**Rationale**: résumé details must never again depend on one external model (SC: résumé read with the AI off).

**Tests**: synthetic résumés in the formats above. No real data.

## R3. Learning everywhere: keys and order

**Decision**: saved answers (`custom_answers`) get **canonical keys**.

- **Recognised profile-type questions:** if a box maps to a profile key (`profileKeyFor`, with the section taken into account), its learned answer is stored as `@<profile_key>`, for example `@preferred_name`. Any wording that classifies as that key gets it: "Preferred Name", "Preferred First Name", "Nickname", "Goes by".
- **Section-aware classification:** a box labelled "First Name" or "Last Name" inside a block headed *Preferred name* classifies as `preferred_name` / `preferred_last_name`.
- **Other questions:** the normalised question text, as today.
- **Company-specific** → `site|q`. **Essays** → `essay|q`, offered only.
- **Only this site** → today's taught box, unchanged.

**Order for every box** (FR-004):
1. this site's taught box or answer;
2. `@key` learned answer;
3. exact learned question;
4. profile;
5. fuzzy learned question (Jaccard ≥ 0.85, no pivot conflict). The research is unanimous that fuzzy should be conservative; Simplify uses exact match only (https://help.simplify.jobs/articles/7306766).
6. Fuzzy matches between 0.6 and 0.85 are **offered**, never filled.
7. AI.

**Identity guard:** `@first_name`, `@last_name`, `@full_name` and `@email` are learned only from an explicit pointer save, never from typing. Promotion never creates them.

**Typing over a filled box:**
- `typedAnswers` no longer skips profile-key boxes.
- A typed value that differs from what Job Catcher filled saves `@key`; for identity keys, nothing is saved.
- Empty profile fields are still filled in the profile (spec 018 behaviour kept).

**Promotion at release** (in the extension when the bundle loads, idempotent):
- Taught rows with a typed answer whose label (plus section) maps to a non-identity key, or to a plain question, are promoted to the general key.
- If they disagree, the most recent wins.
- With the owner's rows, `@preferred_name = Sam`. The Workday "first name" row only promotes if its section shows *preferred*; otherwise it stays site-only.

**Rejected**:
- Embeddings: none of the tools surveyed use them, and they add latency and cost.
- Making the 0.72 Jaccard cutoff looser: causes false fills.

## R4. Repeating sections

**Decision**: generalise `workday.js` into a **section filler** (`sections/`) with per-ATS adapters and one generic adapter.

**Workday adapter** (selectors from job_app_filler, workday-autofill and Application Lane):
- Rows: `div[role=group][aria-labelledby$="-panel"]` (Work-Experience-N, Education-N, Languages-N, Websites-N, Certifications-N), or the older `[data-automation-id^="workExperience-"]`.
- Add: `button[data-automation-id="add-button"]` inside `[aria-labelledby$="-section"]`.
- Fields:
  - jobs: `formField-jobTitle`, `companyName`, `location`, `currentlyWorkHere`, `startDate`/`endDate`, `roleDescription`
  - dates: `dateSectionMonth-input` / `dateSectionYear-input`
  - education: `school`/`schoolName`, `degree`, `fieldOfStudy`, `firstYearAttended`/`lastYearAttended`
  - languages: `formField-language`, `input[name=native]`, the other listbox buttons in the row
  - websites: `formField-url`/`websiteAddress`
  - skills: `formField-skills`
- Count rows by structure, not by index (ids can be arbitrary).

**Generic adapter**:
- Groups from `classifySections`.
- Add buttons match `/^(\+\s*)?add( another| more)?\b/i` inside or after the section, never Submit/Save/Next.
- Greenhouse: `.add-another-button`. SuccessFactors: `div.addRowButton`.

**Behaviour**:
- Fill row *i* from entry *i*.
- Press Add until the row count equals the entry count (max 10), waiting up to 2 s for each new row.
- **Correct pre-filled values** that differ from the chosen résumé's details, recorded in the session for Undo.
- Never touch boxes the user changed this page (the existing `userTouched` set).
- Runs on automatic steps too.

**Dates**:
- Workday month/year sections: set `value = n-1`, then ArrowUp, then click. That's job_app_filler's commit trick (`workday/Dates/utils.ts`).
- Verify the value. Otherwise fall back to keystroke typing, and then leave the box "for you".
- **No** `chrome.debugger`: it shows a banner and needs a scary permission.

## R5. One dropdown at a time

**Decision**: a dropdown **driver** with a global lock.

1. **Before opening:** close any open popup (Escape on the active element, then a click on `[data-automation-id=mainContent]` or `document.body` when `[data-automation-activepopup=true]` or `[aria-expanded=true]` lists are still open). Skip if the control already shows the wanted value; reopening is what left the Degree list open in Application Lane.
2. **Open:** pointer events, plus `click()`. iCIMS needs mousedown; react-select opens on mousedown.
3. **Find options:** scoped to the control's `aria-controls`/`aria-owns` popup, or the active Workday popup, visible rects only. Click `promptLeafNode` when present. Virtual lists: scroll the grid, wait 300 ms, re-query.
4. **Choose** with the existing `firstMatch` (exact, then loose). Never "first option".
5. **Verify** the control's text or chip.
6. **Close and confirm closed** (`aria-expanded` false and no active popup) before the next field.

Search prompts (Workday multiselect, skills): type the term, Enter, wait up to 1.5 s for a `promptLeafNode` or chip; on several results pick the best match; verify the chip count went up.

## R6. Languages

**Decision**:
- `application_profile.languages`: a JSON list of `{language, native, comprehension, reading, speaking, writing, overall}`, each level 1–5.
- **Option matching:**
  1. An option starting with `^\d\s*-` maps by its number, rescaled to the option count.
  2. Otherwise a nearest-first synonym ladder: 5 Native/Bilingual/Fluent/Expert/Excellent; 4 Advanced/Full professional; 3 Intermediate/Professional working/Conversational; 2 Limited/Basic; 1 Beginner/Elementary.

  Sources: LinkedIn levels https://learn.microsoft.com/en-us/linkedin/shared/references/fields/languages; ILR https://en.wikipedia.org/wiki/ILR_scale; Application Lane's `languages.ts`.
- One stored level fills every ability dropdown in a row that has no specific ability.

## R7. Résumé details per résumé and choosing the résumé

**Decision**:
- `resumes.parsed_history` (JSON) is extended to `{work, education, skills, certifications, websites}`.
- `PUT /v1/autofill/resumes/{id}/details` lets the user edit details from the app (session only).
- A saved job can be linked to a résumé: new nullable `saved_jobs.resume_id` (FK `resumes.id`, `ON DELETE SET NULL`). The existing `track_id → resume` link is used when `resume_id` is empty.
- **The panel shows "Filling from: <résumé> · Change".** The choice saves to the linked job, or is kept for this tab when there's no linked job.
- `GET /v1/autofill/resumes/{id}` (pass-allowed, owner-checked) returns that résumé's file and details for the copy.
- **Backfill:** a scheduler job reads résumés with `parsed_history_at IS NULL`, five per run, AI then built-in. A **Read my résumé** button runs it on demand.

## R8. Security (spec 019 rules)

- New routes are session-only unless Job Catcher must call them.
- Pass-allowed: `GET /v1/autofill/resumes/{id}` and `PUT /v1/saved-jobs/{id}/resume`. Both owner-checked, both added deliberately to `PASS_ROUTES`.
- Learned answers keep the existing guards: SELF_ID, CONSENT, PRIVATE, NOISE, passwords and payment are never saved.
