# Job Enhancer — Job Catcher (Browser Extension)

Save jobs from any site to your Job Enhancer tracker — **two ways**:

- **On Indeed / LinkedIn:** a **Save to Job Enhancer** button appears right in the
  job's header (next to Apply/Save). One click reads the title, company, and
  location and saves it. It shows **blue "✓ Already saved"** for jobs already in
  your tracker — *before* you click — and green for new ones.
- **Anywhere else:** open the **side panel** (toolbar icon) and click **Capture this
  page** — it reads the job for you — or **Pick manually** to click the exact element.
  The panel stays open while you browse and links to your tracker.

Chromium (Chrome / Edge / Brave), Manifest V3.

## How capture works (the important part)

Extraction is a **pure function** — `extractJob(document, url)` in
[`src/extract/`](src/extract/) — that tries, in order:

1. **schema.org `JobPosting` JSON-LD** — a standardized block most boards embed
   (Indeed, LinkedIn, Glassdoor, Greenhouse, Lever, Workday…). Stable, not brittle.
2. **Per-site selectors** — Indeed / LinkedIn detail-page headers, used only when
   JSON-LD is missing.
3. **Generic `og:title` / `h1`** — a conservative title for any other site.

Because it's a pure function, it's **unit-tested against saved HTML fixtures** — we
prove capture works without a browser and without hitting live job boards. The same
tested code runs in the on-page button *and* the side panel, so green tests mean real
capture works.

## Setup

```bash
cd extension
npm install
npm run build      # bundles src/ → dist/ (needed once; re-run after editing src/extract)
cp config.example.js config.js   # fill in your public Supabase + API values
```

Then load it: `chrome://extensions` → **Developer mode** on → **Load unpacked** →
select this `extension/` folder → pin the icon. Make sure the backend is running
(`localhost:8000`).

## Use

1. Click the toolbar icon → **side panel** → **sign in once**.
2. **On Indeed / LinkedIn:** click the green **Save to Job Enhancer** button on a job.
3. **Anywhere else:** in the panel, **Capture this page** (or **Pick manually**) →
   review the pre-filled form → **Save to tracker**.
4. Open your tracker from the panel footer anytime.

## Testing

```bash
npm test          # vitest — extractor unit tests against fixtures (fast, no browser)
npm run test:e2e  # playwright — loads the built extension in real Chromium
npm run check     # build + unit tests
```

- **Unit tests** ([`test/extract.spec.js`](test/extract.spec.js)) cover every
  extraction path. To lock a selector against reality, save a real job page's HTML
  into [`test/fixtures/`](test/fixtures/) and add a test pointing at it.
- **E2E** ([`e2e/extension.spec.js`](e2e/extension.spec.js)) loads the extension,
  injects the capture bundle, and asserts it stores the parsed job — MV3 needs a
  headed/persistent context (or `xvfb` in CI).

## Notes

- It **never submits** applications — it only saves jobs you choose.
- If a site isn't parsed well, use **Capture this page** / **Pick manually** and edit
  the form. Add a fixture + test and we tighten the parser.
- **When you deploy:** set the production `API_BASE` / `APP_URL` in `config.js`, then
  publish to the **Chrome Web Store** for one-click install (no developer mode).
