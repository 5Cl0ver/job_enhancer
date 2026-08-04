// Backfill richer job detail from a listing page's RAW HTML.
//
// The background worker fetches the real /viewjob page (there's no DOM there,
// so we parse the HTML as text) and pulls the FULL description + salary + job
// type out of its schema.org JobPosting JSON-LD. This is what fixes home-feed
// captures, where the on-page snippet is short/empty — and gives us the extra
// fields worth filtering on later.
import { jobPostingsFromHtml, mapJobPosting } from "./extract/jsonld-map.js";

/**
 * @param {string} html  raw listing HTML
 * @param {string} url   the listing url (fallback for the posting url)
 * @returns {{description?:string, salary_min?:number, salary_max?:number, job_type?:string}}
 */
export function enrichFromHtml(html, url) {
  const out = {};
  const postings = jobPostingsFromHtml(html || "");
  if (!postings.length) return out;
  const f = mapJobPosting(postings[0], url);
  if (!f) return out;
  if (f.description) out.description = f.description;
  if (f.salary_min != null) out.salary_min = f.salary_min;
  if (f.salary_max != null) out.salary_max = f.salary_max;
  if (f.job_type) out.job_type = f.job_type;
  return out;
}
