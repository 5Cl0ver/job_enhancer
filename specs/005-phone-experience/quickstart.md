# Quickstart: validating the phone experience

## Prerequisites

- Backend + frontend running on the local trial stack.
- A test user with ~300 saved jobs across the stages and a few email updates,
  using invented companies.
- For the last section: the user's own phone.

## Automated checks

```bash
cd frontend && npx tsc --noEmit && npx vitest run && npx vite build
cd frontend && npx playwright test tests/e2e/phone.spec.ts      # 390×844, touch
cd backend && pytest tests/api/test_attention.py -q
```

The phone spec measures each page the way the audit in
[research.md](research.md) R1 did, and must show:

| Check | Must be | Was |
|---|---|---|
| My Jobs: first job's top edge | ≤ 200 px | 452 px |
| My Jobs: jobs on the first screen | ≥ 8 | 1 |
| My Jobs: page height before more loads | ≤ 4 screens | 109 |
| Any page: elements past the right edge | 0 | 18 (My Jobs) |
| Any page: sideways scroll | none | none |
| Primary actions under 44 px tall | 0 | nearly all |
| Fields under 16 px text | 0 | filters at 14 px |
| Bottom bar | My Jobs · Email · Find Jobs · More | no Email |
| Email Updates from any page | 1 tap | Settings, 7th card |

Component tests must prove:

1. `useIsPhone` switches the shell: tab bar + top bar under 768 px, sidebar at
   or above it.
2. The Email tab shows the `/attention` count and hides it at 0.
3. More lists Admin only for admins, and "Show Claude Scout" only when hidden.
4. Stage chips: counts match the jobs, choosing one filters the list and is
   remembered; a remembered stage that no longer exists falls back to All.
5. The filter sheet's "Show N jobs" equals the list it produces; Clear resets.
6. Hiding Scout removes the Find Jobs switch and is undone from the toast,
   More, or Settings; the preference is per device (no request is sent).
7. A job with a very long title and company keeps its row inside the screen.
8. Add job, as a sheet, keeps Save reachable with every field filled.

## Manual walk-through on a phone-sized window

1. Open the app at 390 px: it lands on **My Jobs**; ten rows show.
2. Tap **Applied** in the chips, then 🔍 and type a company; tap the row; press
   **Move to** → Interview; go Back: the list is where you left it.
3. Open the filter sheet, set Remote, press **Show N jobs**; remove the chip.
4. Tap **Email**: the count matches the cards; press **Not this** on one, Undo
   from the toast; open another card to read the email in the sheet; press
   the phone's Back: the sheet closes, the page stays.
5. **Find Jobs** → ⋯ → **Hide Claude Scout**; the switch is gone. **More** →
   **Show Claude Scout** brings it back.
6. **More** → Settings: a list of sections; open Email, go back.
7. Turn on Reduce Motion: sheets appear without sliding; everything works.

## On the user's own iPhone (before each merge to live)

1. Share → **Add to Home Screen**; open it: no browser bars; the tab bar sits
   above the home indicator.
2. Tap a search field: the page does not zoom.
3. Open Add job, focus the last field: the keyboard doesn't cover **Save**.
4. Rotate to landscape: nothing is cut off.

## Screenshots for the README

My Jobs, the filter sheet, an email update card, the More sheet — phone, dark
and light — taken with the phone spec's `--update-snapshots` run.
