// The saved job a tab is applying for when its page doesn't say (spec 040).
// PURE: unit-tested in test/files-and-tabs-040.spec.js.
//
// An application often leaves the job's own page: the job board's Apply
// opens the company's site (Dayforce, iCIMS…) in the same tab or a new
// one, and those pages rarely name the job. The tab keeps the job it was on
// (and a tab it opens inherits it), so the job's own résumé and cover letter
// are the ones used there. Kept for 2 hours from the job's own page; going
// back to a job board, a search engine or the app forgets it (the next job
// the user opens from there is another one).

export const TAB_JOB = "je_tab_job";
export const CARRY_MS = 2 * 60 * 60_000;
const KEEP = 50; // tabs remembered

const HUB = /(^|\.)(linkedin\.com|lnkd\.in|indeed\.com|ziprecruiter\.com|glassdoor\.com|simplyhired\.com|monster\.com|bing\.com|duckduckgo\.com|claude\.ai)$/i;
const APP = /(^|\.)job-enhancer[\w-]*\.vercel\.app$/i;

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/** A job board, a search engine or the app: where the user picks the NEXT job. */
export function onHub(url) {
  const host = hostOf(url);
  return !host || HUB.test(host) || APP.test(host) || host === "google.com" || /^google\.[a-z.]+$/.test(host);
}

/** The job board a page is on (its "Apply on company website" leads elsewhere). */
export function onJobBoard(url) {
  const host = hostOf(url);
  return !!host && /(^|\.)(linkedin\.com|indeed\.com|ziprecruiter\.com|glassdoor\.com|simplyhired\.com|monster\.com)$/i.test(host);
}

/** The job carried to this page, else null. */
export function carriedJobId(entry, url, now = Date.now()) {
  if (!entry?.jobId || now - (entry.at || 0) > CARRY_MS) return null;
  return onHub(url) ? null : entry.jobId;
}

/**
 * The tab's entry after a page loads in it: the page's own job (from now on),
 * else what it carried — forgotten on a hub or once too old.
 */
export function nextEntry(entry, url, ownJobId, now = Date.now()) {
  if (ownJobId) return { jobId: ownJobId, at: now };
  if (!entry?.jobId || now - (entry.at || 0) > CARRY_MS) return null;
  // A tab just opened from the job passes the board's redirect on its way
  // (linkedin.com/redir…): only its first page off the board settles it.
  if (onHub(url)) return entry.opened ? entry : null;
  return entry.opened ? { jobId: entry.jobId, at: entry.at } : entry;
}

/** The tabs map with one tab's entry set (or removed), newest last, capped. */
export function putEntry(map, tabId, entry) {
  const { [tabId]: _old, ...rest } = map || {};
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return entry ? { ...Object.fromEntries(kept), [tabId]: entry } : Object.fromEntries(kept);
}
