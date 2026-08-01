# Job Enhancer — Job Catcher (Browser Extension)

Save jobs from any site to your Job Enhancer tracker — **two ways**:

- **"+ Save" buttons** appear right on job cards (Indeed / LinkedIn / Glassdoor) —
  one click saves that job.
- **Side panel** (toolbar icon) — a sidebar that **stays open** while you browse.
  Use **Pick from page** to grab a job from *any* other site, review, and save.
  It also lists what you've saved this session and links to your tracker.

Chromium (Chrome / Edge / Brave), Manifest V3, plain HTML/JS — no build step.

## Install (developer mode)

1. Copy `config.example.js` → `config.js` and fill in your values (all public).
2. Make sure your backend is running (`localhost:8000`).
3. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select this
   `extension/` folder → pin the icon.

## Use

1. Click the toolbar icon to open the **side panel**, and **sign in once**.
2. **On Indeed / LinkedIn / Glassdoor:** click the green **+ Save** on any job card.
3. **Anywhere else:** in the panel, click **Pick from page** → click the job title
   on the page → it fills the panel instantly → **Save to tracker**.
4. Open your tracker anytime from the panel footer.

## Notes

- It **never submits** applications — it only saves jobs you choose.
- Card selectors are best-effort per site; if a button doesn't appear or grabs the
  wrong data, use **Pick from page** (works on any site). Per-site parsing improves
  over time — tell us the URL and we add a parser.
- **When you deploy:** set the production `API_BASE`/`APP_URL` in `config.js`, add
  the production API to `host_permissions` in [manifest.json](manifest.json), then
  publish to the **Chrome Web Store** for one-click install (no developer mode).
