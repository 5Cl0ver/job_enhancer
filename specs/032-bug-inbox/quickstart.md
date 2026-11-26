# Quickstart: check the Bug inbox works (032)

Prerequisites: the backend and frontend running locally (README "Run it locally"), signed in as the `ADMIN_EMAIL` account, plus a second, non-owner account.

## Automated

```bash
cd backend && .venv/Scripts/python -m pytest tests -k "bug_report or attention or apply_checklist or migration"
cd frontend && npm test -- bugs
cd extension && npm test -- report
```

These must show:
- every `/v1/admin/bugs*` route and every connector tool refuses the non-owner;
- planted passwords, codes, emails, phone and card numbers never come back from any read;
- 100 identical caught errors give 1 report with `count` 100;
- a fixed report seen again is `new` with `came_back_at` set;
- migration up and down works, with the 5 starting entries added once and old run problems mapped.

## By hand (PR A)

1. **Admin → Bugs & ideas:** the 5 starting entries show (3 bugs, 2 ideas), with section counts.
2. **Add a bug from My Jobs on a phone-sized window:**
   - the section is App and the page is `/jobs`;
   - Save shows "Added" and you stay on the page;
   - it's in the list.
3. **Mark it confirmed, then fixed with "PR #1":** it leaves the open view, and its history shows both steps.
4. **Select 2 rows and choose "Copy 2 for Claude":** the pasted text has 2 numbered reports, with page text fenced.
5. **As the non-owner:** there's no Add button and no Bugs & ideas, and `/admin/bugs` sends you away.

## By hand (PR B)

1. **Add a bug with a phone photo:** the image shows in its detail view.
2. **Break a page on purpose** (dev only, `?crash=1` in a test build): the friendly screen shows, and one App crash report appears. Do it twice: count 2.
3. **Use a wrong app password on a test mailbox and press scan:** one Email updates report, with no address in it.
4. **Mark the crash fixed, crash again:** it's back at the top, saying "Came back".

## By hand (PR C)

1. **In a Claude chat with the connector:** "list my open Job Catcher bugs", then "mark <id> fixed in PR #2". In the app it shows "Fixed by Claude: needs your check". Press **Looks fixed**.
2. **Job Catcher 0.45.0 on a lab page:** **Report a problem here** with "Add a picture". The report has the site, the page without its query, version 0.45.0, and the picture.
3. **Signed in on Job Catcher as the non-owner:** no report link.
