# Quickstart: check Apply from the app

## Automated

| Part | Command |
|---|---|
| Backend | `cd backend && pytest -q tests/test_apply_from_app.py tests/test_mcp_apply.py tests/api/test_apply_api.py tests/test_migration_apply_from_app.py` |
| Frontend | `cd frontend && npx vitest run tests/components/apply tests/lib/apply.test.ts` |
| Job Catcher | `cd extension && npx vitest run test/apply-mode.spec.js && npm run build && npx playwright test e2e/apply.spec.js` |

## By hand (live, after all three PRs)

1. **Update Job Catcher.** Install 0.41.0. The application page's readiness line says "Job Catcher 0.41.0 is ready".
2. **Start a run.** Press Apply with Claude and paste the line into Claude in Chrome.
3. **Go to the phone.** On the phone, open the application page:
   - The conversation shows Claude's updates.
   - Send "Use my Gmail address": Claude's next update mentions it.
4. **Answer from the phone.** When Claude needs you, the card shows a photo of the screen and quick answers. Tap one, and Claude carries on.
5. **Show me the screen.** It gives a photo of the tab as it is.
6. **Submit and confirm.** At the review, press Submit. Job Catcher sees the confirmation, and the page shows "Sent, confirmed" with its photo.
7. **Stopped notice.** Close the Claude chat mid-run. Within about 3 minutes the page says Claude stopped and shows the carry-on line.
