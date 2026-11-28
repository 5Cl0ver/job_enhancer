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
// job's letter on a company's application is not. So:
// - a carry onto another site starts ONLY right after the user pressed an
//   Apply that leaves (`armed`, src/autofill/applyClick.js): never a typed
//   address, a bookmark, Back, an ad or a link in a posting's text;
// - it is tied to the application's site (`siteOf`: an applicant system's
//   tenant or company) and its posting (`postingIds`);
// - it ends on any job board, search engine or app page (a new tab only
//   passes its own board's redirect on its way out), on another posting
//   (both pages name one, and they differ), on another site (a sign-in on the
//   way excepted, and the company's posting handing over to its applicant
//   system straight after an Apply press), and after 45 minutes with no page
//   on its site.

import { applicantHost, siteKey } from "./autofill/hosts.js";

export const TAB_JOB = "je_tab_job";
export const CARRY_MS = 45 * 60_000; // idle: every page on the site restarts it
export const ARM_MS = 20_000; // an Apply press counts for this long
const HANDOVER_MS = 2 * 60_000; // from the held posting to its applicant system
const KEEP = 50; // tabs remembered

const TLD = "(?:com|net|org|ai|io|jobs|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})";
// Job boards and aggregators: where the user picks the NEXT job.
const BOARD = new RegExp(
  `(^|\\.)(linkedin\\.(?:com|cn)|lnkd\\.in|indeed\\.${TLD}|glassdoor\\.${TLD}|ziprecruiter\\.${TLD}|simplyhired\\.${TLD}|monster\\.${TLD}|careerbuilder\\.${TLD}|builtin[a-z]*\\.com|dice\\.com|wellfound\\.com|welcometothejungle\\.com|jobright\\.ai|joinhandshake\\.com|handshake\\.com|usajobs\\.gov)$`,
  "i",
);
const HUB = /(^|\.)(bing\.com|duckduckgo\.com|claude\.ai)$/i;
const APP = /(^|\.)job-enhancer[\w-]*\.vercel\.app$/i;
// A board's own way out to the company's site.
const BOARD_REDIRECT = /^\/(redir\b|safety\/go\b|applystart\b|rc\/clk\b|pagead\/clk\b|jobs\/view\/externalApply\b|partner\/jobListing\b|clk\b)/i;
// Sign-ins on the way to an application: passed through, never "another site".
const SIGN_IN = /(^|\.)(okta\.com|oktapreview\.com|auth0\.com|microsoftonline\.com|login\.microsoft\.com|login\.live\.com|onelogin\.com|pingone\.com|b2clogin\.com|accounts\.google\.com)$/i;
// Never the application in a tab of its own: sign-ins, file pickers.
const NOT_APPLICATION = /(^|\.)(accounts\.google\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|box\.com|login\.live\.com|microsoftonline\.com|okta\.com|auth0\.com)$/i;
// An application or careers page (the server's looks_like_application).
const APPLICATION = /job|career|apply|applicat|recruit|talent|hiring|position|opening|requisition|candidate|workday|greenhouse|lever\.co|icims|taleo|dayforce|smartrecruiters|ashbyhq|jobvite|workable|successfactors|paylocity|paycom|ultipro|adp\.com/i;
// The query parts that name a posting (never a timestamp or a tracking id).
const POSTING_PARAMS = new Set(["jk", "vjk", "gh_jid", "ashby_jid", "job", "jobid", "job_id", "jid", "id", "req", "reqid", "requisitionid", "postingid", "jobreqid", "opportunityid", "jobpostingid", "positionid", "currentjobid"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const REQ = /(?<![a-z])(?:jr|req|r)[-_]?\d{2,}(?![a-z0-9])/gi;

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

/** An http(s) page: anything else (about:blank, chrome://) changes nothing. */
export const isWebPage = (url) => !!parse(url);

/** The registrable domain ("jobs.example.co.uk" → "example.co.uk"). */
function domainOf(url) {
  const parts = hostOf(url).split(".");
  if (parts.length < 2) return parts[0] || "";
  const two = parts.slice(-2).join(".");
  return parts.length > 2 && /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
}

/** The site an application belongs to: an applicant system's tenant or company (siteKey), else the domain. */
export function siteOf(url) {
  return applicantHost(url) ? siteKey(url) : domainOf(url);
}

/** A job board, a search engine or the app: where the user picks the NEXT job. */
export function onHub(url) {
  const host = hostOf(url);
  return !host || BOARD.test(host) || HUB.test(host) || APP.test(host) || host === "google.com" || /^google\.[a-z.]+$/.test(host);
}

/** A job board or aggregator (its Apply leads elsewhere). */
export function onJobBoard(url) {
  const host = hostOf(url);
  return !!host && BOARD.test(host);
}

/**
 * The ids in an address that name a posting: UUIDs, requisition ids (R-1234,
 * JR-1234), runs of 3+ digits in the path or the #route, and the posting's
 * own query parts (`job=12345`, `opportunityId=…`, Indeed's `jk`). A query
 * part is kept as "name=value" too, so another value of it is another posting.
 */
export function postingIds(url) {
  const u = parse(url);
  if (!u) return [];
  const ids = new Set();
  const take = (text, named) => {
    let rest = text.toLowerCase();
    for (const re of [UUID, REQ]) {
      rest = rest.replace(re, (m) => {
        ids.add(m.replace(/[-_]/g, ""));
        return " ";
      });
    }
    for (const m of rest.match(/\d{3,}/g) || []) ids.add(m);
    if (named) ids.add(`${named}=${text.toLowerCase()}`);
  };
  take(decodeURIComponent(u.pathname));
  take(u.hash);
  for (const [k, v] of u.searchParams) {
    const name = k.toLowerCase();
    if (!v || !POSTING_PARAMS.has(name)) continue;
    // Indeed's jk is its posting id, letters and all.
    if (name === "jk" || name === "vjk") ids.add(v.toLowerCase());
    take(v, name);
  }
  return [...ids];
}

/** An address that surely names one posting. */
export const definitePosting = (url) => postingIds(url).length > 0;

/**
 * Are these two pages' ids the same posting? Only when both name one and
 * none is shared, or a posting query part changed (`opportunityId`), is it
 * another posting.
 */
export function samePosting(held, ids) {
  if (!held?.length || !ids?.length) return true;
  const mine = new Set(held);
  if (!ids.some((id) => mine.has(id))) return false;
  const named = (list) => new Map(list.filter((id) => id.includes("=")).map((id) => id.split(/=(.*)/s).slice(0, 2)));
  const before = named(held);
  for (const [k, v] of named(ids)) if (before.has(k) && before.get(k) !== v) return false;
  return true;
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

/** The board's own redirect out of `fromSite` (its query ids don't count). */
export function boardRedirect(fromSite, url) {
  const u = parse(url);
  return !!u && onJobBoard(url) && domainOf(url) === fromSite && BOARD_REDIRECT.test(u.pathname);
}

const expired = (entry, now) => !entry?.jobId || now - (entry.at || 0) > CARRY_MS;

/** The entry for a saved job's own page. */
function ownEntry(jobId, url, now) {
  if (onHub(url)) return { jobId, at: now };
  const ids = postingIds(url);
  return { jobId, at: now, site: siteOf(url), ats: !!applicantHost(url), ...(ids.length ? { posting: ids, postingAt: now, onPosting: true } : {}) };
}

/**
 * The tab's entry after a page loads in it: the page's own job (from now
 * on), else what it carried, else null (see the top for when it ends).
 * `armed`: the user pressed an Apply that leaves in this tab just now.
 */
export function nextEntry(entry, url, ownJobId, now = Date.now(), { armed = false } = {}) {
  if (!isWebPage(url)) return entry || null;
  if (ownJobId) return ownEntry(ownJobId, url, now);
  if (expired(entry, now)) return null;
  if (onHub(url)) {
    // Only a new tab on its way out, through its own board's redirect.
    return entry.opened && boardRedirect(entry.from, url) ? entry : null;
  }
  if (SIGN_IN.test(hostOf(url))) return entry; // a sign-in on the way
  const site = siteOf(url);
  const ats = !!applicantHost(url);
  const ids = postingIds(url);
  const { opened, from, ...kept } = entry;
  if (!kept.site) {
    // Off the job's own page onto the application: only right after an
    // Apply press (a new tab exists only after its opener's), and only onto
    // an application.
    if (!(armed || opened) || !(ats || looksLikeApplication(url))) return null;
    return { jobId: kept.jobId, at: now, site, ats, ...(ids.length ? { posting: ids, postingAt: now, onPosting: true } : {}) };
  }
  if (site !== kept.site) {
    // The company's posting hands over to its applicant system: straight
    // from that posting's page (within 2 minutes), after an Apply press on it.
    const fresh = kept.posting && kept.onPosting && now - (kept.postingAt || 0) <= HANDOVER_MS;
    if (!ats || kept.ats || !(armed || opened) || !fresh) return null;
    return { jobId: kept.jobId, at: now, site, ats: true, ...(ids.length ? { posting: ids, postingAt: now, onPosting: true } : {}) };
  }
  if (!samePosting(kept.posting, ids)) return null; // another posting
  const posting = kept.posting || (ids.length ? ids : null);
  const onPosting = ids.length > 0;
  return { ...kept, at: now, ...(posting ? { posting } : {}), ...(onPosting ? { postingAt: now } : {}), onPosting };
}

/** The job carried to this page, else null. */
export function carriedJobId(entry, url, now = Date.now()) {
  if (!isWebPage(url) || onHub(url) || expired(entry, now)) return null;
  // Read-only: the page as it is now is still the carried job's.
  if (!entry.site) return null;
  if (siteOf(url) !== entry.site && !SIGN_IN.test(hostOf(url))) return null;
  return samePosting(entry.posting, postingIds(url)) ? entry.jobId : null;
}

/** The tabs map with one tab's entry set (or removed), newest last, capped. */
export function putEntry(map, tabId, entry) {
  const { [tabId]: _old, ...rest } = map || {};
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return entry ? { ...Object.fromEntries(kept), [tabId]: entry } : Object.fromEntries(kept);
}
