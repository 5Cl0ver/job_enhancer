// Indeed detail-page (viewjob) selector fallback — used only when JSON-LD is
// absent or partial. These target the OPEN job page, not search cards, which is
// the reliable capture surface (one job, stable header markup).
import { textFrom, looksRemote, descriptionByHeading } from "./util.js";

// The full job description as rendered on the page. Known containers first
// (viewjob + search-pane markup); the home-feed pane uses different markup, so
// fall back to anchoring on the visible "Full job description" heading — if the
// user can read the description, we can capture it.
function descriptionText(doc) {
  for (const sel of [
    "#jobDescriptionText",
    "[id^='jobDescriptionText']",
    ".jobsearch-JobComponent-description",
    "[class*='jobDescriptionText']",
    "[data-testid*='jobDescription']",
  ]) {
    const el = doc.querySelector(sel);
    const t = (el?.textContent || "").trim();
    if (t) return t;
  }
  return descriptionByHeading(doc);
}

export function extractIndeed(doc, url) {
  const title = textFrom(doc, [
    "h1.jobsearch-JobInfoHeader-title",
    "[data-testid='jobsearch-JobInfoHeader-title']",
    "h2[data-testid='jobsearch-JobInfoHeader-title']",
    "h1 span[title]",
  ]);
  const company = textFrom(doc, [
    "[data-testid='inlineHeader-companyName'] a",
    "[data-testid='inlineHeader-companyName']",
    "[data-company-name='true']",
    ".jobsearch-CompanyInfoContainer a",
  ]);
  const location = textFrom(doc, [
    "[data-testid='inlineHeader-companyLocation']",
    "[data-testid='job-location']",
    ".jobsearch-JobInfoHeader-subtitle div:last-child",
  ]);
  const description = descriptionText(doc);
  const body = doc.body?.textContent || "";
  return {
    title,
    company,
    location,
    description,
    is_remote: looksRemote(location, title, body),
    url,
  };
}
