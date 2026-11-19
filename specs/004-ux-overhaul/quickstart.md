# Quickstart: validating the UX overhaul

## Prerequisites

- Backend + frontend running on the local trial stack, migrations at head.
- A test user seeded with ~200 saved jobs spread over the stages (one stage
  with 150+), using invented companies.

## Automated checks

```bash
cd backend && pytest tests/services/test_job_tasks.py tests/services/test_email_scan_job.py \
  tests/api/test_tasks.py tests/api/test_email_history.py tests/test_migration_job_tasks.py -q
cd frontend && npx tsc --noEmit && npx vitest run && npx playwright test e2e/board.spec.ts && npx vite build
```

They must prove:

1. **Drop on a card moves it**: a card dropped onto a column full of cards
   lands in that column (10 of 10). ([contracts/ui.md](contracts/ui.md) My Jobs)
2. **A failed move is said out loud**: with the move endpoint failing, the card
   returns and a toast with Retry appears.
3. **Search**: typing a company dims the rest, shows "n of N" per column, and
   finds a card beyond the first 30.
4. **One to-do per email**: scanning the same interview email twice leaves one
   task; "Not this" removes it; Undo brings it back.
   ([data-model.md](data-model.md) `job_tasks`)
5. **History**: after apply and after dismiss, the event is in
   `GET /email/events?view=history` with the right `outcome` and `acted_by`.
6. **Scan status**: start → running with rising `checked` → done; a heartbeat
   older than 90 s reads `stopped`; status never contains a subject or sender.
7. **No-stage jobs**: the migration backfills them; a new save gets the first
   stage.
8. **Foreign ids**: every new endpoint returns 404 for another user's task,
   event or resume type.

## Manual walk-through (the demo)

1. **Board**: open My Jobs → Board at 1366×768. No page scroll; scroll one
   column; headers stay. Press `/`, type a company, press Enter: the card
   pulses. Drag it onto the longest column: it moves. Use Move to… on another.
2. **Phone** (375 px): stage chips switch columns; Move to… works; More sheet
   lists every page.
3. **Needs you**: scan a mailbox holding an assessment email for a saved job.
   The card shows the badge, the panel lists it, the nav shows 1. Open the
   drawer from the panel; set a date; tick it off; all three clear.
4. **Email updates**: press Scan and switch to My Jobs and back; the count kept
   rising. Approve one update and dismiss another; find both in History; Undo
   one.
5. **View email**: open one in the app. Press **Open in Yahoo** on a real Yahoo
   account and confirm it lands on that email or a one-result search. *If the
   prefixes are ignored, switch to the keyword fallback (research R7).*
6. **Scout**: with a fresh user, follow the checklist to a copied prompt
   without opening Edit; drop a PDF on a resume type card.
7. **Reduced motion**: turn it on in the OS; hover, pulse and slides are gone,
   everything still works.

## Before going live

- Back up the live database (the migration adds a table and columns and
  backfills NULL stages).
- Merge slices one at a time; after each, check `/health` and the changed
  screen on live.
