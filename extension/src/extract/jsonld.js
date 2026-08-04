// Primary extractor: schema.org JobPosting embedded as JSON-LD.
// Indeed, LinkedIn, Glassdoor, Greenhouse, Lever, Workday and thousands of other
// boards emit <script type="application/ld+json"> with @type "JobPosting". This
// is a stable, documented contract — far less brittle than CSS selectors — so we
// try it first and fall back to per-site selectors only when it's missing.
//
// The field mapping lives in jsonld-map.js (pure, no DOM) so the background
// worker can reuse it on raw HTML too.
import { collectJobPostings, mapJobPosting } from "./jsonld-map.js";

/**
 * @returns {null | {title,company,location,is_remote,url,description,job_type,salary_min,salary_max}}
 */
export function extractFromJsonLd(doc, url) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const postings = [];
  for (const s of scripts) {
    try {
      collectJobPostings(JSON.parse(s.textContent), postings);
    } catch {
      continue; // malformed block — skip, don't blow up the whole capture
    }
  }
  if (!postings.length) return null;
  return mapJobPosting(postings[0], url);
}
