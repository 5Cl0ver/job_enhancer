// Workday job pages (spec 034): the job page's own JSON-LD (extracted first
// by jsonld.js), then Workday's stable data-automation-id hooks — the
// posting header (title), the locations list, the description — and the
// company from the Workday site's name. Also the job a Workday APPLICATION
// belongs to, read from its address (…/job/Portland-OR/Title_JR-1/apply).
// PURE (DOM only): unit-tested in test/workday-034.spec.js.
import { tenantCompany, workdayAddress } from "../autofill/track.js";
import { clean, stripHtml } from "./util.js";

const AID = (id) => `[data-automation-id="${id}"]`;

/** Is this a Workday address? */
export function isWorkday(url) {
  return !!workdayAddress(url);
}

/**
 * The job on a Workday page, from its own markup and address (JSON-LD is
 * read by the caller first). `guessed`: only a heading and the site's name
 * were there ("check this"). Null off Workday.
 */
export function extractWorkday(doc, url) {
  const where = workdayAddress(url);
  if (!where) return null;
  const header = clean(doc.querySelector(AID("jobPostingHeader"))?.textContent);
  const locs = doc.querySelector(AID("locations"));
  const location = clean(locs?.querySelector("dd")?.textContent || locs?.textContent?.replace(/^\s*locations?\s*/i, ""));
  const descEl = doc.querySelector(AID("jobPostingDescription"));
  return {
    title: header || where.title || clean(doc.querySelector("h1, h2")?.textContent),
    company: tenantCompany(where.tenant),
    location: location || where.location,
    description: descEl ? stripHtml(descEl.innerHTML) : "",
    url: where.posting || url,
    is_remote: /\bremote\b/i.test(`${header} ${location}`),
    guessed: !header,
  };
}
