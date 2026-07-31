# Job Enhancer — Job Catcher (Browser Extension v1)

Save any job posting to your Job Enhancer tracker in one click. Chromium
(Chrome / Edge / Brave), Manifest V3, plain HTML/JS — no build step.

## Install (developer mode)

1. Copy `config.example.js` → `config.js` and fill in your values
   (`API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` — all public client values).
2. Make sure your backend is running (`localhost:8000`).
3. Open `chrome://extensions`.
4. Turn on **Developer mode** (top-right).
5. Click **Load unpacked** and select this `extension/` folder.
6. Pin the extension to your toolbar.

## Use

1. Open a job posting (LinkedIn, Indeed, a company careers page, …).
2. Click the Job Enhancer icon.
3. First time only: sign in with your Job Enhancer email/password.
4. Review the auto-filled **title / company / location** (edit as needed).
5. Click **Save to tracker** — the job appears in your tracker (source `manual`).

## Notes

- It **never submits** applications — it only saves jobs you choose (spec FR-022).
- Detail auto-fill is best-effort; per-site parsing improves over time. You can
  always edit before saving.
- **When you deploy:** add your production API URL to `host_permissions` in
  [manifest.json](manifest.json) and set `API_BASE` in `config.js`.
