// LinkedIn detail-page extractor.
//
// LinkedIn is the hardest capture target: logged-in job pages render NO JSON-LD,
// and LinkedIn RANDOMIZES its CSS class names on every deploy (e.g. the job
// title sits in `<p class="_18f99264 d836b1ef …">`), so class selectors rot
// within days. The one thing that stays stable is the document <title>, which is
// always "Job Title | Company | LinkedIn". We parse that first, then use only
// markup-independent fallbacks (the /company/ link, an <h1>, the "About the job"
// heading) to fill gaps. PURE (DOM only) — unit-tested against a saved fixture.
//
// NOTE: the side panel's "Save the job on this page" uses a SEPARATE, inline
// copy of this logic in ../../sidepanel.js (`extractJobFromPage`), because that
// function is injected into the page and must be self-contained (no imports).
// Keep the two in sync — if LinkedIn changes, both need the same fix.
import { textFrom, looksRemote } from "./util.js";

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

/**
 * Parse "Job Title | Company | LinkedIn" from the tab title. Returns empty
 * strings for non-job pages ("Feed | LinkedIn") so we never save garbage.
 */
export function titleFromDocTitle(rawTitle) {
  const parts = clean(rawTitle)
    .split("|")
    .map((p) => clean(p).replace(/^\(\d+\)\s*/, "")) // drop the "(3) " unread badge
    .filter((p) => p && !/^linkedin$/i.test(p));
  if (parts.length < 2) return { title: "", company: "" }; // not a job view
  return { title: parts[0], company: parts[1] };
}

/**
 * The job description: anchor on the "About the job" heading and slice the
 * surrounding section's text from there — that drops the top-card prefix while
 * keeping every sub-section (a job may nest "Overview"/"Requirements" headings
 * that a sibling-walk would stop at) — then trim trailing LinkedIn sidebar noise.
 */
export function descriptionFrom(doc) {
  const h = [...doc.querySelectorAll("h1, h2, h3")].find((e) =>
    /about the job/i.test(clean(e.textContent)),
  );
  if (!h) return "";
  const scope = h.closest("section") || h.parentElement?.parentElement || doc.body;
  const full = clean(scope.textContent || "");
  const idx = full.search(/about the job/i);
  let desc = (idx >= 0 ? full.slice(idx) : full).replace(/^about the job\s*/i, "");
  desc = desc.split(
    /Set alert for similar jobs|People you can reach out to|Meet the hiring team|Unlock hiring insights|Similar jobs/i,
  )[0].trim();
  return desc.slice(0, 12000);
}

export function extractLinkedIn(doc, url) {
  const { title: docTitle, company: docCompany } = titleFromDocTitle(
    doc.querySelector("title")?.textContent || "",
  );

  // Title/company: the <title> is authoritative; fall back to markup-independent
  // anchors (never the hashed classes).
  let title = docTitle || clean(textFrom(doc, ["h1"]));
  let company = docCompany;
  if (!company) {
    const org = doc.querySelector('a[href*="/company/"]');
    company = clean(org?.textContent || "");
  }

  // Location: scope a "City, ST" search to the top card around the company link
  // (a full-page search would match unrelated text). Best-effort — the save only
  // needs title + company, so a miss here is harmless.
  let location = "";
  const org = doc.querySelector('a[href*="/company/"]');
  let box = org;
  for (let i = 0; i < 4 && box; i++) box = box.parentElement;
  // Drop the company name first so "Initech, Inc." can't be read as the location.
  let near = clean(box?.textContent || "");
  if (company) near = near.split(company).join(" ");
  const loc = near.match(/([A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,2},\s*[A-Z]{2})\b/);
  if (loc) location = loc[1];

  const body = doc.body?.textContent || "";
  return {
    title,
    company,
    location,
    description: descriptionFrom(doc),
    is_remote: looksRemote(location, title, body),
    url,
  };
}
