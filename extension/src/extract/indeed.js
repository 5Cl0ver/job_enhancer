// Indeed detail-page (viewjob) selector fallback — used only when JSON-LD is
// absent or partial. These target the OPEN job page, not search cards, which is
// the reliable capture surface (one job, stable header markup).
import {
  textFrom,
  looksRemote,
  descriptionByHeading,
  stripHtml,
  textAfterHeading,
  parseSalaryText,
  parseJobTypes,
} from "./util.js";

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
    if (!el) continue;
    // innerHTML + stripHtml, NOT textContent — Indeed embeds a <style> block
    // inside the description container and textContent leaks the CSS text.
    const t = stripHtml(el.innerHTML || "") || (el.textContent || "").trim();
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

  // The visible "Job details" block ("$85,000 - $100,000 a year - Permanent,
  // Full-time") — parse pay + job types from what the user actually sees.
  const detailsText =
    (doc.querySelector("#salaryInfoAndJobType")?.textContent || "") ||
    textAfterHeading(doc, [/^job details/i], 5);
  const salary = parseSalaryText(detailsText) || {};
  const job_type = parseJobTypes(detailsText);

  return {
    title,
    company,
    location,
    description,
    // Only STRUCTURED remote signals: the location line ("Remote in Pomona,
    // CA") or the title. Never scan the whole page — on a feed, some OTHER
    // card always says "remote" and every job got falsely flagged.
    is_remote: looksRemote(location, title),
    url,
    job_type,
    salary_min: salary.salary_min ?? null,
    salary_max: salary.salary_max ?? null,
    salary_period: salary.salary_period ?? null,
  };
}
