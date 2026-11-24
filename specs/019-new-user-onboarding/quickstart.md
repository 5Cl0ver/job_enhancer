# Quickstart: validating 019

All test data is invented: accounts like `wren@example.com` and the sample résumé `backend/tests/fixtures/` style files. Never use real personal data.

## Prerequisites (one-time)

**Nothing for the owner to configure.**
- The release reads four public repository variables (`JC_API_BASE`, `JC_APP_URL`, `JC_SUPABASE_URL`, `JC_SUPABASE_ANON_KEY`). They were set from the live values when PR A was built.
- Connect needs no Supabase secret (research R4), and forgot-password needs no dashboard change (R7).

**After PR A merges**, re-add Job Catcher once on each computer. The new pinned key gives it a fixed id, `jihebibpgbfpmponcpphjbgnppodffed`, so later updates keep their settings:
1. Download from `/job-catcher`.
2. Remove the old Job Catcher.
3. Load the new folder.
4. Press Connect.

## Automated checks

| Area | Command | Proves |
|---|---|---|
| Backend | `cd backend; .venv/Scripts/python -m pytest -q` | onboarding derive/patch; connect start/approve/poll (single use, expiry, wrong token, wrong proof, cancel, pass revoke/idle/age/cap, pass can't approve); allowances (spend, refund, block, admin exempt, jsearch reserve, period rollover); hello/latest (cache, GitHub down); export/delete include new rows; admin columns |
| Frontend | `cd frontend; npm test; npm run build` | Welcome steps and skip; checklist ticks and hide; InfoBubble hover/tap/Esc; Login redirect safety (`//evil`, `https://evil` rejected); forgot/reset; Job Catcher page states (not installed / connected / outdated / phone) |
| Extension | `cd extension; npm run check; npx playwright test` | Connect flow against the fake API (start → the app page gets the proof → approve → poll → signed in with a pass; other codes and other sites get no proof; sign-out revokes); expiry and cancel; update banner when `/extension/latest` is newer; hello sent once per hour |
| Release | push a manifest version bump to a test branch and run the workflow with `workflow_dispatch` | the zip contains manifest/config/icons/dist; config has only https live URLs; the workflow fails when a variable is localhost or empty |

## Manual end-to-end (one pass, about 15 minutes)

1. **New account**: in a fresh browser profile, sign up with a new email. The Welcome opens. Upload the sample résumé; the profile fills; press **Looks right**.
2. **Skip and resume**: skip the Job Catcher step and close the Welcome. The Getting started card shows 2 of 4 done.
3. **Install**: on a clean Chrome profile, open `/job-catcher`, download, and follow only the six steps. Job Catcher loads with no edits.
4. **Connect**: press **Connect to Job Enhancer**. The app tab shows the same code; press **Connect**. The panel is signed in within a few seconds, and the checklist ticks Job Catcher.
5. **GitHub account**: repeat step 4 with a GitHub-only account. It must work.
6. **Update note**: load an older zip. The panel banner and the app chip both say update available.
7. **Allowances**: set `ai_document` to 1 in Admin → Allowances. Generate two cover letters as the test user: the second shows the friendly message and nothing is spent. The owner is never blocked.
8. **Phone**: on a phone, open the app as the new user. The Welcome, checklist, bubbles, profile review and Settings all work; `/job-catcher` shows Share and Copy instead of steps.
9. **Admin**: the user list shows the test users' ticks, Job Catcher version, last active and usage.
10. **Existing user**: sign in as the owner. No Welcome is forced; the checklist (if shown) is already mostly ticked.
