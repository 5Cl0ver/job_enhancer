# Quickstart: prove Autofill is always findable and fills

Everything runs on invented lab pages and a fake app server. No real employer or personal data is used.

## Run

```bash
cd extension
npm run build
npx vitest run                 # unit: label styles, presence rule, hosts, national phone
npx playwright test e2e/autofill-find.spec.js
npx playwright test            # everything (spec 015 suites must stay green)
```

## Lab pages (`extension/test/lab/`)

| Page | What it imitates | Address used in tests (routed to the lab) |
|---|---|---|
| `paycom-like.html` | A careers page; "Apply" opens a React-style `role=dialog aria-modal` pop-up with MUI-like floating labels, a phone with a "+1" picker, a privacy checkbox, a consent radio, a résumé uploader that rewrites name/email after upload, and a cookie banner at the bottom | `https://www.paycomonline.net/v4/ats/web.php/portal/0000/career-page` |
| `labels.html` | The 7 label styles: before, after (floating), wrapping, `for`, aria-label, table cell, placeholder-only | `https://careers.example-lab.test/contact` |
| `covered.html` | A form with a cookie banner and a chat bubble filling the bottom corners, and a native `<dialog>` opened with `showModal()` | `https://jobs.example-lab.test/openings/42` |
| `frame-form.html` | A company page embedding the form in a cross-site frame | the top page on one lab origin, the frame on the other |

## Expected outcomes

1. **Panel always offers it (US1).** On each page, once the form is visible, the first button in the panel is "⚡ Autofill this page", within 1 s. With no form, the panel says "No form on this page yet…".
2. **Badge.** The toolbar badge shows ⚡ when a form is present. After a fill it shows the count for 4 s.
3. **Nothing drawn on the page; status always clear.**
   - No Job Catcher button exists on any lab page.
   - On `covered.html`, with a native modal open and a cookie banner, the panel still reaches "Form found" and fills.
   - During a press the status reads "Filling… N of M", then a result line.
   - A frame that never answers gives "This is taking too long: try again" after 20 s.
4. **Fills (US2).** On the Paycom-like pop-up:
   - first/last name, email, phone (national digits, picker = US), address and city are filled;
   - the résumé is uploaded first;
   - the privacy checkbox and consent radio are untouched and listed under "Needs you";
   - nothing behind the pop-up is filled.
5. **Labels.** All 7 styles on `labels.html` are read as their real question (unit + e2e).
6. **Shortcut.** The panel shows the real assigned key (Alt+Shift+J in tests), and pressing the command fills.
7. **One line (US3).** For every outcome there is one sentence: filled N, nothing matched, signed out, app asleep, page unreachable.

## Manual check after merge (the user)

1. Reload Job Catcher in `chrome://extensions`, then refresh the job tab.
2. Open the side panel. ⚡ Autofill is at the top on any page with a form.
