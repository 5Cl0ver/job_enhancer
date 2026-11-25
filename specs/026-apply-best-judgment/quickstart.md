# Quickstart: Apply with best judgment

## Automated

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_mcp_apply.py tests/test_apply_from_app.py tests/test_apply_best_judgment.py -q
cd frontend && npm test -- apply && npm run build
cd extension && npm test && npm run test:e2e
```

They cover:
- hidden upload boxes behind "Select files" (a Workday-like fixture);
- the run's résumé chosen over a URL guess;
- bring-to-front photos putting the user's tab back;
- the live snapshot (sensitive boxes dropped, caps, only on change);
- answer flags and fixes through the tools;
- bubble ordering and the fix tray.

## By hand (the owner's next run)

1. Save a Workday job, press **Apply with Claude**, and paste the prompt into Claude in Chrome.
2. While Claude fills, open the application page on the phone: **Filling now** lists the boxes as they fill.
3. On "My Experience", the résumé made for the job is attached (the Pages row says so).
4. Stay on another tab on the computer. Each page still gets photos, and your tab comes back.
5. Claude only stops for sign-in, CAPTCHA, or a real experience question.
6. At the review, guesses and agreements come first. Change one, ask about another, and press **Send fixes**. The review comes back with them fixed.
