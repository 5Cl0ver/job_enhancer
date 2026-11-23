// Reads a job off ANY page. Injected into the page with chrome.scripting, so it
// must be fully self-contained: no references to anything outside the function.
// JSON-LD JobPosting first (Glassdoor, most company sites, many boards), then
// og-tags + headings + visible text (Lever, plain sites). Highlighted text wins
// as the description. Moved unchanged from the old sidepanel.js; on Indeed /
// LinkedIn / ZipRecruiter the content script answers instead with the tested
// extractJob() (src/extract/).
//
// The LinkedIn branch MIRRORS src/extract/linkedin.js; keep them in step.
export function extractJobFromPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const stripHtml = (html) => {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    div.querySelectorAll("style,script,noscript").forEach((e) => e.remove());
    return (div.innerText || div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  };
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  const isLinkedIn = /(^|\.)linkedin\.com$/i.test(location.hostname);
  const out = {
    url: location.href,
    title: "",
    company: "",
    location: "",
    description: "",
    is_remote: false,
    salary_min: null,
    salary_max: null,
    salary_period: null,
  };

  // 1) JSON-LD JobPosting — the gold standard when present.
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
    for (const node of nodes) {
      const t = node && node["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (!types.includes("JobPosting")) continue;
      out.title = clean(node.title) || out.title;
      const org = node.hiringOrganization;
      out.company = clean(typeof org === "string" ? org : org?.name) || out.company;
      const loc = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
      const addr = loc?.address;
      if (addr) {
        out.location =
          clean([addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ")) ||
          out.location;
      }
      if (String(node.jobLocationType || "").toUpperCase() === "TELECOMMUTE") out.is_remote = true;
      if (node.description) out.description = stripHtml(node.description);
      const bs = node.baseSalary?.value || node.baseSalary;
      if (bs && typeof bs === "object") {
        const min = Number(bs.minValue) || null;
        const max = Number(bs.maxValue) || null;
        const val = Number(bs.value) || null;
        out.salary_min = min || val || out.salary_min;
        out.salary_max = max || out.salary_max;
        const unit = String(bs.unitText || "").toUpperCase();
        if (unit === "HOUR") out.salary_period = "hourly";
        else if (unit === "YEAR" || unit === "MONTH") out.salary_period = "yearly";
      }
      if (out.title && out.company) break;
    }
    if (out.title && out.company) break;
  }

  // 2) og:title is often "Company - Title" (Lever, many boards).
  const ogTitle = clean(meta('meta[property="og:title"]'));
  if (ogTitle.includes(" - ")) {
    const idx = ogTitle.indexOf(" - ");
    if (!out.company) out.company = clean(ogTitle.slice(0, idx));
    if (!out.title) out.title = clean(ogTitle.slice(idx + 3));
  }

  // 2.5) LinkedIn: no JSON-LD, no og-tags, and randomized CSS classes. Anchor on
  // the things that DON'T change: the <title>, a lone "City, ST" span, and the
  // "About the job" heading. (The generic body-dump below would grab nav + the
  // Premium upsell instead, so we skip it for LinkedIn.)
  if (isLinkedIn) {
    const parts = clean(document.title)
      .split("|")
      .map((p) => clean(p).replace(/^\(\d+\)\s*/, "")) // drop "(3) " unread badge
      .filter((p) => p && !/^linkedin$/i.test(p));
    if (parts.length >= 2) {
      if (!out.title) out.title = parts[0];
      if (!out.company || out.company === "linkedin") out.company = parts[1];
    }
    // Location: the top card shows it as a standalone "City, ST" span.
    const CITY_ST = /^[A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2},\s*[A-Z]{2}$/;
    for (const el of document.querySelectorAll("span")) {
      const t = clean(el.textContent);
      if (CITY_ST.test(t)) {
        out.location = t;
        break;
      }
    }
    // Description: the real posting is under an "About the job" heading. Rather
    // than walk siblings (fragile — a job may nest an "Overview" sub-heading that
    // ends the walk early), take the surrounding section's text and SLICE from
    // "About the job" onward — that drops the top-card prefix while keeping every
    // sub-section — then trim any trailing LinkedIn sidebar noise.
    const h = [...document.querySelectorAll("h1, h2, h3")].find((e) =>
      /about the job/i.test(clean(e.textContent)),
    );
    if (h) {
      const scope = h.closest("section") || h.parentElement?.parentElement || document.body;
      const full = stripHtml(scope.innerHTML);
      const idx = full.search(/about the job/i);
      let desc = (idx >= 0 ? full.slice(idx) : full).replace(/^about the job\s*/i, "");
      desc = desc.split(
        /Set alert for similar jobs|People you can reach out to|Meet the hiring team|Unlock hiring insights|Similar jobs/i,
      )[0].trim();
      out.description = desc.slice(0, 12000);
    }
  }

  // 3) Headings / site name fallbacks.
  if (!out.title)
    out.title =
      clean(document.querySelector("h1, .posting-headline h2, h2")?.innerText) ||
      ogTitle ||
      clean(document.title);
  if (!out.company) {
    const hn = location.hostname;
    if (/lever\.co$/.test(hn) || /greenhouse\.io$/.test(hn) || /ashbyhq\.com$/.test(hn)) {
      out.company = clean(location.pathname.split("/").filter(Boolean)[0]);
    }
    out.company =
      out.company ||
      clean(meta('meta[property="og:site_name"]')) ||
      clean(document.querySelector('[class*="company" i], [data-company]')?.innerText) ||
      clean(hn.replace(/^www\./, "").split(".")[0]);
  }

  // 4) Description fallback — the main content region. Skipped on LinkedIn,
  // where "main" is the whole feed (nav + Premium upsell), not the posting.
  if (!out.description && !isLinkedIn) {
    const main = document.querySelector(
      "[data-qa='job-description'], .posting-page, main, article, [class*='description' i], [class*='job' i]",
    );
    out.description = stripHtml(main?.innerHTML || document.body?.innerHTML || "").slice(0, 12000);
  }

  // 5) Remote + salary from visible text if still unknown. The salary scan is
  // skipped on LinkedIn — its noisy full-page text produced false hits (a stray
  // "$100"); better to leave pay blank than wrong.
  const bodyText = document.body?.innerText || "";
  if (/\bremote\b/i.test(out.title + " " + out.location + " " + bodyText.slice(0, 1500)))
    out.is_remote = true;
  if (!out.salary_min && !isLinkedIn) {
    const m = bodyText.match(
      /\$\s?([\d,]{3,})(?:\s?(?:-|–|—|to)\s?\$?\s?([\d,]{3,}))?\s*(per hour|an hour|\/\s?hr|hourly|per year|a year|annually)?/i,
    );
    if (m) {
      const toN = (x) => (x ? Number(x.replace(/,/g, "")) : null);
      out.salary_min = toN(m[1]);
      out.salary_max = toN(m[2]);
      const p = (m[3] || "").toLowerCase();
      out.salary_period = /hour|hr/.test(p) ? "hourly" : /year|annual/.test(p) ? "yearly" : null;
    }
  }

  // If the user HIGHLIGHTED text on the page, trust that as the description —
  // the reliable escape hatch for sites we can't read structurally.
  const sel = (window.getSelection?.().toString() || "").trim();
  if (sel.length > 40) out.description = sel;
  return out;
}
