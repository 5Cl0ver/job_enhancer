// The saved job a tab is applying for when its page doesn't say (spec 040).
// PURE: unit-tested in test/files-and-tabs-040.spec.js.
//
// An application often leaves the job's own page: the job board's Apply
// opens the company's site (Dayforce, iCIMS…) in the same tab or a new
// one, and those pages rarely name the job. The tab keeps the job it was on
// (and a tab it opens inherits it), so the job's own résumé and cover letter
// are the ones used there.
//
// When in doubt, no carry: the usual résumé and no letter is safe; another
// job's letter on a company's application is not. So the carry is tied to
// the first application site the tab reaches (and its posting, when the
// address names one), and it ends on:
// - any job board, search engine or app page, except the board's own
//   redirect on a new tab's way out (linkedin.com/redir…);
// - another posting;
// - a first site that isn't an application;
// - another site, unless it's a sign-in on the way (Okta, Microsoft…) or the
//   company's site handing over to its applicant system, once;
// - 45 minutes after the job's own page.

import { applicantHost, postingKey } from "./autofill/hosts.js";

export const TAB_JOB = "je_tab_job";
export const CARRY_MS = 45 * 60_000;
const KEEP = 50; // tabs remembered

const BOARD = /(^|\.)(linkedin\.com|lnkd\.in|indeed\.com|ziprecruiter\.com|glassdoor\.com|simplyhired\.com|monster\.com)$/i;
const HUB = /(^|\.)(bing\.com|duckduckgo\.com|claude\.ai)$/i;
const APP = /(^|\.)job-enhancer[\w-]*\.vercel\.app$/i;
// A board's own way out to the company's site: never a posting of its own.
const BOARD_REDIRECT = /^\/(redir\b|safety\/go\b|applystart\b|rc\/clk\b|pagead\/clk\b|jobs\/view\/externalApply\b|partner\/jobListing\b|clk\b)/i;
// Sign-ins on the way to an application: passed through, never "another site".
const SIGN_IN = /(^|\.)(okta\.com|oktapreview\.com|auth0\.com|microsoftonline\.com|login\.microsoft\.com|login\.live\.com|onelogin\.com|pingone\.com|b2clogin\.com|accounts\.google\.com)$/i;
// Never the application in a tab of its own: sign-ins, file pickers.
const NOT_APPLICATION = /(^|\.)(accounts\.google\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|box\.com|login\.live\.com|microsoftonline\.com|okta\.com|auth0\.com)$/i;
// An application or careers page (the server's looks_like_application).
const APPLICATION = /job|career|apply|applicat|recruit|talent|hiring|position|opening|requisition|candidate|workday|greenhouse|lever\.co|icims|taleo|dayforce|smartrecruiters|ashbyhq|jobvite|workable|successfactors|paylocity|paycom|ultipro|adp\.com/i;

function parse(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

function hostOf(url) {
  return parse(url)?.hostname.toLowerCase().replace(/^www\./, "") || "";
}

/** The site an address belongs to ("jobs.example.co.uk" → "example.co.uk"). */
export function siteOf(url) {
  const parts = hostOf(url).split(".");
  if (parts.length < 2) return parts[0] || "";
  const two = parts.slice(-2).join(".");
  return parts.length > 2 && /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
}

/** A job board, a search engine or the app: where the user picks the NEXT job. */
export function onHub(url) {
  const host = hostOf(url);
  return !host || BOARD.test(host) || HUB.test(host) || APP.test(host) || host === "google.com" || /^google\.[a-z.]+$/.test(host);
}

/** The job board a page is on (its "Apply on company website" leads elsewhere). */
export function onJobBoard(url) {
  const host = hostOf(url);
  return !!host && BOARD.test(host);
}

/** An address that surely names one posting: an applicant system's id, or an id in it. */
export function definitePosting(url) {
  const k = postingKey(url);
  if (!k) return null;
  return k.sure || /\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k.key.slice(k.scope.length)) ? k.key : null;
}

/** An application or careers page, never a sign-in or a file picker. */
export function looksLikeApplication(url) {
  const u = parse(url);
  if (!u || NOT_APPLICATION.test(hostOf(url))) return false;
  return APPLICATION.test(`${u.hostname}${u.pathname}`);
}

/**
 * Should Claude hear of a tab the application's tab opened? Only when it
 * left a job board (the board's Apply), or is an application on another
 * site — never a sign-in, a file picker, a privacy page or an ad.
 */
export function worthTelling(openerUrl, url) {
  if (!parse(url) || onHub(url) || NOT_APPLICATION.test(hostOf(url))) return false;
  if (onJobBoard(openerUrl)) return true;
  return looksLikeApplication(url) && siteOf(url) !== siteOf(openerUrl);
}

/** The board's own redirect out of `fromSite` (a new tab on its way out). */
export function boardRedirect(fromSite, url) {
  const u = parse(url);
  return !!u && onJobBoard(url) && siteOf(url) === fromSite && !definitePosting(url) && BOARD_REDIRECT.test(u.pathname);
}

const expired = (entry, now) => !entry?.jobId || now - (entry.at || 0) > CARRY_MS;

/**
 * The tab's entry after a page loads in it: the page's own job (from now
 * on), else what it carried, else null (see the top for when it ends).
 */
export function nextEntry(entry, url, ownJobId, now = Date.now()) {
  const posting = definitePosting(url);
  if (ownJobId) {
    if (onHub(url)) return { jobId: ownJobId, at: now };
    return { jobId: ownJobId, at: now, site: siteOf(url), ats: !!applicantHost(url), ...(posting ? { posting } : {}) };
  }
  if (expired(entry, now)) return null;
  if (onHub(url)) {
    // Only a new tab on its way out, through its own board's redirect.
    return entry.opened && boardRedirect(entry.from, url) ? entry : null;
  }
  if (SIGN_IN.test(hostOf(url))) return entry; // a sign-in on the way
  const site = siteOf(url);
  const ats = !!applicantHost(url);
  let { site: held, ats: heldAts, posting: heldPosting } = entry;
  // The first site after the job's page must be an application (a news
  // site or a shop typed in the same tab is not).
  if (!held && !ats && !looksLikeApplication(url)) return null;
  if (held && site !== held) {
    // The company's site hands over to its applicant system, once (its
    // posting there has the system's own id).
    if (!ats || heldAts) return null;
    held = site;
    heldAts = true;
    heldPosting = undefined;
  }
  // Another posting on the same site: another job.
  if (posting && heldPosting && posting !== heldPosting) return null;
  const kept = heldPosting || posting;
  return { jobId: entry.jobId, at: entry.at, site: held || site, ats: held ? !!heldAts : ats, ...(kept ? { posting: kept } : {}) };
}

/** The job carried to this page, else null. */
export function carriedJobId(entry, url, now = Date.now()) {
  if (onHub(url)) return null;
  return nextEntry(entry, url, null, now)?.jobId || null;
}

/** The tabs map with one tab's entry set (or removed), newest last, capped. */
export function putEntry(map, tabId, entry) {
  const { [tabId]: _old, ...rest } = map || {};
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return entry ? { ...Object.fromEntries(kept), [tabId]: entry } : Object.fromEntries(kept);
}
