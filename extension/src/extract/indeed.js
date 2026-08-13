// Indeed detail-page (viewjob) selector fallback — used only when JSON-LD is
// absent or partial. These target the OPEN job page, not search cards, which is
// the reliable capture surface (one job, stable header markup).
import {
  textFrom,
  clean,
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

// Indeed's Quick-Apply flow (smartapply.indeed.com and /apply) is a React app —
// no JSON-LD, none of the viewjob selectors above. But it renders the WHOLE
// posting in a side "JobInfoCard": title, a single "Company - Location"
// subtitle, and the full description (salary/benefits/body). Saving mid-apply
// used to grab only title+company off the step header; this reads the real job.
//
// Returns null when the apply card isn't present, so it's a no-op on every
// other Indeed page (the normal viewjob path stays in charge there).
export function extractIndeedApply(doc, url) {
  if (!doc?.querySelector) return null;
  const card =
    doc.querySelector("[data-testid='JobInfoCard-wrapper']") ||
    doc.querySelector(".ia-JobDescription")?.closest("aside") ||
    null;
  if (!card) return null;

  const title = textFrom(card, ["#ia-JobInfoCard-header-title", ".ia-JobHeader-title"]);

  // The subtitle is one line, "Veriheal - Portland, OR". Split on the FIRST
  // separator so the "City, ST" (which has its own comma) stays intact.
  let company = "";
  let location = "";
  const sub = clean(card.querySelector(".ia-JobHeader-information span")?.textContent || "");
  const m = /^(.+?)\s+[-–·•]\s+(.+)$/.exec(sub);
  if (m) {
    company = clean(m[1]);
    location = clean(m[2]);
  } else if (sub) {
    company = sub;
  }

  const descEl = card.querySelector(".ia-JobDescription");
  const description = descEl ? stripHtml(descEl.innerHTML || "") || clean(descEl.textContent) : "";

  // The description opens with structured lines — "Company • Full-Time • Remote/
  // Hybrid" and "Salary: $80,000 - $93,000" — so mine pay/type/remote from the
  // TOP only; a stray "$" or "remote-first" deeper in the body can't mislead us.
  const head = description.slice(0, 300);
  let salary = parseSalaryText(head) || {};
  // The apply card writes salary without a period ("Salary: $80,000 - $93,000"),
  // which parseSalaryText (needs "a year"/"hourly") skips. Recognise that label
  // form: five-figure+ numbers next to "Salary" are annual by convention.
  if (salary.salary_min == null) {
    const s = /salary\b[^$]*\$\s*([\d,]+(?:\.\d+)?)(?:\s*[-–]\s*\$\s*([\d,]+(?:\.\d+)?))?/i.exec(head);
    if (s) {
      const lo = Math.round(parseFloat(s[1].replace(/,/g, "")));
      const hi = s[2] ? Math.round(parseFloat(s[2].replace(/,/g, ""))) : null;
      if (Number.isFinite(lo) && lo >= 1000) {
        salary = { salary_min: lo, salary_max: hi, salary_period: "yearly" };
      }
    }
  }
  const job_type = parseJobTypes(head);

  if (!title && !description) return null;

  return {
    title,
    company,
    location,
    description,
    is_remote: looksRemote(location, title, head),
    url,
    job_type,
    salary_min: salary.salary_min ?? null,
    salary_max: salary.salary_max ?? null,
    salary_period: salary.salary_period ?? null,
  };
}
