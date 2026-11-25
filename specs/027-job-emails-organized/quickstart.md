# Quickstart: Every email about a job, kept and organized

## Automated

```bash
cd backend && .venv/Scripts/python -m pytest tests -k "email" -q
cd frontend && npm test -- email && npm run build
```

New tests, with anonymized fixtures shaped like the real misses:
- **noted:** an "applied" confirmation with the card already in Applied; a second interview email with the card in Interview; a second rejection.
- **digest:** a title inside a longer title; the same title at several companies; generic company names in a signature. Each is kept. Real board alerts are still digests.
- **re-check:** adds only new rows, moves no card, saves no cursor.
- **sections:** the kind → section mapping, the summary line, and seen.

## On the owner's inbox (read only first)

1. Run `.venv/Scripts/python scripts/email_scan_debug.py --days 5`. It now uses the real decision.
   - **Expected:** the 10 emails from Nov 23–25 show as noted or moved, none as dropped.
   - **Also expected:** LinkedIn, Glassdoor, Lensa, Indeed and Snagajob alerts show as "looked at: job alert".
2. After deploy, press **Re-check the last 30 days** on Email updates.
   - **Expected:** "found N", and the 10 emails from the investigation are on their jobs.
   - **Expected:** no card moved.
3. Open the job with the second interview email.
   - **Expected:** Interviews & next steps lists both interview emails, the newest marked New.
   - **Expected:** opening the job clears the dot on its board card.
