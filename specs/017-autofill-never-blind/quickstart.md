# Quickstart: prove Autofill never goes blind

Everything runs on invented lab pages and a fake app server. No real employer pages or personal data are used.

## Run

```bash
cd extension && npm run build
npx vitest run                                   # visibility rule, report (no values), fingerprint scoring
npx playwright test e2e/autofill-never-blind.spec.js
npx playwright test                              # the spec 015 and 016 suites stay green
cd ../backend && pytest tests/api/test_taught_fields.py tests/api/test_autofill_bundle.py
```

## Lab pages

| Page | Imitates |
|---|---|
| `paycom-modal.html` | The real failure: "Getting You Started" in a MUI v4-style modal. `#root` holds the dialog and gets `aria-hidden="true"`, the way ModalManager does with `disablePortal`. The pop-up has Legal First/Last Name, Email, Confirm Email, a phone with a "+1" picker, opacity-0 SMS Yes/No radios and an opacity-0 privacy checkbox. |
| `unlabeled.html` | Boxes with no label at all: one plain, one inside a closed shadow root, one inside a same-site frame. |
| `blank-frame.html` | A form written into an `about:blank` frame by the page's script. |

## Expected outcomes

1. **The fix.**
   - On `paycom-modal.html` (served at a paycomonline.net address), a press fills first name, last name, email, confirm email and phone (national number).
   - The SMS question and the privacy box are listed under "Needs you".
   - Before the fix, the same test finds 0 fields (record it in the PR).
2. **Every frame.** `blank-frame.html` fills. A tab whose script was removed fills after **Read the page again**.
3. **Never stuck.**
   - Every failure state shows the three actions.
   - **Copy what Job Catcher saw** puts a report on the clipboard, with frames, fields and drop reasons. None of the profile's values appear in it.
4. **Point and teach.**
   - On `unlabeled.html`: Point at a box, click the box, choose "Email", and it fills.
   - Reload, press Autofill: it fills by itself.
   - The same works for the shadow-root box and the frame box.
   - Pointing at the privacy box is refused.
   - Settings lists the taught boxes, and Remove works.
5. **Both computers.** The taught box comes back in `GET /v1/autofill/bundle` (pytest).

## After merge (the user)

1. Say "update Job Catcher" to Claude on the laptop. On this computer it's already built.
2. Reload Job Catcher in `chrome://extensions`, refresh the Paycom page, then press Autofill.
3. If anything is off, press **Copy what Job Catcher saw** and paste it to Claude.
