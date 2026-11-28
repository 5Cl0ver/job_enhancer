// Which saved job a page of an application is for (spec 040), when the
// page doesn't say. PURE: unit-tested in test/files-and-tabs-040.spec.js.
//
// Job Catcher never decides that by itself. Right after the user's own
// press on an Apply on a saved job's own page (`press`, src/autofill/
// applyClick.js), the side panel SUGGESTS that job on the pages that follow
// (`suggestFor`): its Fill button reads "Fill with <job>'s résumé and
// cover letter", and each press uses the job for that one fill of that one
// page only (`fillJobFor`). Nothing is remembered as "this page is that
// job". Once, on the first application page, the panel asks "Is this the
// application for <job>?": Yes only teaches the job its company link, and
// only when the page names its posting (`postingLevelId`).

import { applicantHost, isApplyUrl, siteKey } from "./autofill/hosts.js";

export const TAB_PRESS = "je_tab_press"; // tab → the press it holds
export const SUGGEST_MS = 45 * 60_000; // a press suggests its job this long
export const OPEN_MS = 20_000; // a tab opened this soon after a press inherits it
export const PICK_MS = 2 * 60_000; // "Fill with <job>'s…" counts for that fill only
const KEEP = 50; // tabs remembered

const TLD = "(?:com|net|org|ai|io|jobs|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})";
// Job boards and aggregators: where the user picks the NEXT job.
const BOARD = new RegExp(
  `(^|\\.)(linkedin\\.(?:com|cn)|lnkd\\.in|indeed\\.${TLD}|glassdoor\\.${TLD}|ziprecruiter\\.${TLD}|simplyhired\\.${TLD}|monster\\.${TLD}|careerbuilder\\.${TLD}|builtin[a-z]*\\.com|dice\\.com|wellfound\\.com|welcometothejungle\\.com|jobright\\.ai|joinhandshake\\.com|handshake\\.com|usajobs\\.gov|jooble\\.org|talent\\.com|adzuna\\.${TLD}|appcast\\.io)$`,
  "i",
);
const HUB = /(^|\.)(bing\.com|duckduckgo\.com|claude\.ai)$/i;
const APP = /(^|\.)job-enhancer[\w-]*\.vercel\.app$/i;
// A board's own way out to the company's site.
const BOARD_REDIRECT = /^\/(redir\b|safety\/go\b|applystart\b|rc\/clk\b|pagead\/clk\b|jobs\/view\/externalApply\b|partner\/jobListing\b|clk\b)/i;
// Sign-ins on the way: passed through, never "another site".
const SIGN_IN = /(^|\.)(okta\.com|oktapreview\.com|auth0\.com|microsoftonline\.com|login\.microsoft\.com|login\.live\.com|onelogin\.com|pingone\.com|b2clogin\.com|accounts\.google\.com|appleid\.apple\.com|accounts\.sap\.com|login\.icims\.com)$/i;
// Never the application in a tab of its own: sign-ins, file pickers.
const NOT_APPLICATION = /(^|\.)(accounts\.google\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|box\.com|login\.live\.com|microsoftonline\.com|okta\.com|auth0\.com)$/i;
// An application or careers page (the server's looks_like_application).
const APPLICATION = /job|career|apply|applicat|recruit|talent|hiring|position|opening|requisition|candidate|workday|greenhouse|lever\.co|icims|taleo|dayforce|smartrecruiters|ashbyhq|jobvite|workable|successfactors|paylocity|paycom|ultipro|adp\.com/i;

// Ids that surely name ONE posting (the server's STRONG_PARAMS).
const STRONG_PARAMS = new Set(["pid", "id", "token", "jvi", "jk", "vjk", "gh_jid", "ashby_jid", "career_job_req_id", "job", "jobid", "job_id", "jid", "req", "reqid", "requisitionid", "postingid", "jobreqid", "opportunityid", "jobpostingid", "positionid", "currentjobid"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ONE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Requisition ids: R-1234, JR-1234, REQ-1234, R1234 (Workday's job ids).
// A repost keeps its suffix: JR12345-1 is not JR-12345.
const REQ = /(?<![a-z0-9])(?:jr|req|r)[-_]?\d{2,}(?:-\d{1,3})?(?![a-z0-9])/gi;
const STATES = "al|ak|az|ar|ca|co|ct|de|dc|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy";
// A zip next to its state ("Portland-OR-97201") and a year are no posting.
const ZIP = new RegExp(`(?<![a-z])(?:${STATES})[-_ ,]+\\d{5}(?:-\\d{4})?(?!\\d)`, "gi");
const YEAR = /(?<!\d)(19|20)\d{2}(?!\d)/g;

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

/**
 * The site an application belongs to: on a host many companies share, the
 * company's own part of it (Workday's /recruiting/<tenant>, UKG's /<tenant>,
 * Dayforce's /<locale>/<tenant>, SuccessFactors' ?company=, ADP's
 * /<tenant>, Paylocity's board id); on an applicant system, its siteKey;
 * else the domain. "" when the company can't be told on a shared host.
 */
export function siteOf(url) {
  const u = parse(url);
  if (!u) return "";
  const host = hostOf(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const low = parts.map((p) => p.toLowerCase());
  // The company's part of a shared host; "?" when the address doesn't say.
  const tenant = (base, key) => `${base}/${key ? key.toLowerCase() : "?"}`;
  const after = (word) => {
    const at = low.indexOf(word);
    return at >= 0 ? parts[at + 1] || "" : "";
  };
  if (/(^|\.)myworkdaysite\.com$/.test(host)) return tenant("myworkdaysite.com", after("recruiting"));
  if (/(^|\.)ultipro\.(com|ca)$|\.rec\.pro\.ukg\.net$/.test(host)) return tenant(host, parts[0]);
  if (/(^|\.)dayforcehcm\.com$/.test(host)) {
    const at = low.findIndex((p) => /^[a-z]{2}-[a-z]{2}$/.test(p));
    return tenant("dayforcehcm.com", at >= 0 ? parts[at + 1] : "");
  }
  if (/successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$/.test(host)) return tenant(host, u.searchParams.get("company"));
  if (/^(myjobs|recruiting|tcs)\.adp\.com$/.test(host)) return tenant(host, parts[0]);
  if (/(^|\.)paylocity\.com$/.test(host)) return tenant(host, parts.find((p) => ONE_UUID.test(p)));
  if (/^ats\.rippling\.com$/.test(host)) return tenant(host, parts[0]);
  if (/^workforcenow\.adp\.com$/.test(host)) return tenant(host, u.searchParams.get("cid"));
  // Jobvite: /<company>/job/… or /careers/<company>/job/….
  if (/(^|\.)jobvite\.com$/.test(host)) return tenant(host, low[0] === "careers" ? parts[1] : parts[0]);
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
 * The ids in an address that name a posting. `strong`: UUIDs, requisition
 * ids (R-1234, JR-1234) and the posting's own query parts (`job=…`,
 * `opportunityid=…`, `career_job_req_id=…`, Indeed's `jk`/`vjk`, kept as
 * "name=value"). `weak`: runs of 3+ digits in the path or #route, years and
 * a zip next to its state left out.
 */
export function postingIds(url) {
  const u = parse(url);
  const strong = new Set();
  const weak = new Set();
  if (!u) return { strong: [], weak: [] };
  const take = (text) => {
    let rest = text.toLowerCase();
    rest = rest.replace(UUID, (m) => {
      strong.add(m);
      return " ";
    });
    rest = rest.replace(REQ, (m) => {
      strong.add(m.replace(/^([a-z]+)[-_]/, "$1"));
      return " ";
    });
    rest = rest.replace(ZIP, " ").replace(YEAR, " ");
    for (const m of rest.match(/\d{3,}/g) || []) weak.add(m.replace(/^0+(?=\d)/, ""));
  };
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* a bad %: as it is */
  }
  take(path);
  take(u.hash);
  for (const [k, v] of u.searchParams) {
    const name = k.toLowerCase();
    if (v && STRONG_PARAMS.has(name)) strong.add(`${name === "vjk" ? "jk" : name}=${v.toLowerCase()}`);
  }
  return { strong: [...strong], weak: [...weak] };
}

const named = (list) => new Map(list.filter((id) => id.includes("=")).map((id) => id.split(/=(.*)/s).slice(0, 2)));
const overlap = (a, b) => {
  const set = new Set(a);
  return b.some((x) => set.has(x));
};

/**
 * Do these two pages name another posting? Strong ids when both have
 * them (none shared, or a posting query part changed: another posting);
 * one side with strong ids and the other with only plain digits: another;
 * plain digits only when neither has a strong id. A page naming no posting
 * at all (a sign-in, a step) is never another posting.
 */
export function otherPosting(a, b) {
  const sa = a?.strong || [];
  const sb = b?.strong || [];
  if (sa.length && sb.length) {
    if (!overlap(sa, sb)) return true;
    const before = named(sa);
    for (const [k, v] of named(sb)) if (before.has(k) && before.get(k) !== v) return true;
    return false;
  }
  const wa = a?.weak || [];
  const wb = b?.weak || [];
  if (sa.length || sb.length) return (sa.length ? wb : wa).length > 0;
  return wa.length > 0 && wb.length > 0 && !overlap(wa, wb);
}

/**
 * The company's own application (`companyUrl`) and this page are surely the
 * same posting: the same site, strong ids on both, none differing.
 */
export function sameApplication(companyUrl, pageUrl) {
  if (!companyUrl || !siteOf(companyUrl) || siteOf(companyUrl) !== siteOf(pageUrl)) return false;
  const a = postingIds(companyUrl);
  const b = postingIds(pageUrl);
  if (!a.strong.length || !b.strong.length) return false;
  if (otherPosting(a, b)) return false;
  // Every posting query part on either side, on the other too.
  const na = named(a.strong);
  const nb = named(b.strong);
  for (const k of new Set([...na.keys(), ...nb.keys()])) if (na.get(k) !== nb.get(k)) return false;
  // Unnamed strong ids (a requisition, a UUID): each side with one the other
  // lacks is another posting (a shared tenant UUID never makes them one).
  const ua = a.strong.filter((x) => !x.includes("="));
  const ub = b.strong.filter((x) => !x.includes("="));
  if (ua.some((x) => !ub.includes(x)) && ub.some((x) => !ua.includes(x))) return false;
  // Plain numbers: each side with one the other lacks.
  const ma = numbersOf(a);
  const mb = numbersOf(b);
  if (ma.some((x) => !mb.includes(x)) && mb.some((x) => !ma.includes(x))) return false;
  return true;
}

/** The plain numbers that name a posting: weak ids and digit-only posting query values. */
function numbersOf(ids) {
  const out = new Set(ids?.weak || []);
  for (const id of ids?.strong || []) {
    const v = id.includes("=") ? id.split(/=(.*)/s)[1] : "";
    if (/^\d{3,}$/.test(v)) out.add(v.replace(/^0+(?=\d)/, ""));
  }
  return [...out];
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
  if (!parse(url) || onHub(url) || isSignIn(url) || NOT_APPLICATION.test(hostOf(url))) return false;
  const application = looksLikeApplication(url) || !!applicantHost(url);
  if (onJobBoard(openerUrl)) return application;
  return application && siteOf(url) !== siteOf(openerUrl);
}

/** The board's own redirect out of `fromSite` (its query ids don't count). */
export function boardRedirect(fromSite, url) {
  const u = parse(url);
  return !!u && onJobBoard(url) && domainOf(url) === fromSite && BOARD_REDIRECT.test(u.pathname);
}

/** The board a page is on, for `boardRedirect`. */
export const boardOf = (url) => domainOf(url);

/** A sign-in on the way: a sign-in host, or a board's own sign-in pages. */
export function isSignIn(url) {
  const u = parse(url);
  if (!u) return false;
  const host = hostOf(url);
  if (SIGN_IN.test(host)) return true;
  if (/(^|\.)linkedin\.com$/.test(host)) return /^\/(oauth|uas|checkpoint)\b/i.test(u.pathname);
  if (/^secure\.indeed\.com$/.test(host)) return /^\/(oauth|account|auth)\b/i.test(u.pathname);
  if (/^online\.adp\.com$/.test(host)) return /^\/signin\b/i.test(u.pathname);
  return false;
}

/**
 * Is there a job to suggest on this page? A press on that job's own page in
 * this tab (or the one that opened it) within 45 minutes, and this page is
 * no saved job by itself, no board, search, app or sign-in page. Only a
 * suggestion: the panel offers "Fill with <job>'s résumé and cover letter",
 * one fill at a time.
 */
export function suggestFor(press, url, ownJobId, now = Date.now()) {
  if (!press?.jobId || now - (press.at || 0) > SUGGEST_MS) return null;
  if (ownJobId || !isWebPage(url) || onHub(url) || isSignIn(url) || NOT_APPLICATION.test(hostOf(url))) return null;
  return press.jobId;
}

/**
 * Is this surely an application page (to ask "Is this the application for
 * <job>?" once, for the job's link)? An applicant system, an /apply page,
 * or a careers page naming a posting.
 */
export function askAbout(press, url, ownJobId, now = Date.now()) {
  if (!suggestFor(press, url, ownJobId, now)) return null;
  const application = applicantHost(url) || isApplyUrl(url) || (looksLikeApplication(url) && postingLevelId(url));
  return application ? press.jobId : null;
}

// The query parts that name ONE posting (never the company: company=, cid…).
const POSTING_PARAMS = new Set(["pid", "id", "token", "jvi", "gh_jid", "ashby_jid", "jk", "vjk", "opportunityid", "career_job_req_id", "job", "jobid", "job_id", "jid", "req", "reqid", "requisitionid", "postingid", "jobreqid", "jobpostingid", "positionid", "currentjobid"]);
// Hosts whose UUIDs name the company (its board), never a posting.
const TENANT_UUIDS = /(^|\.)(ultipro\.(com|ca)|rec\.pro\.ukg\.net|paylocity\.com|adp\.com)$/i;

/**
 * The id that names ONE posting in an address, else null: a posting query
 * part, a requisition id (R-1234, JR-1234), or the applicant system's own
 * posting id in its path (Greenhouse, Lever, Ashby, Workable, Jobvite,
 * SmartRecruiters, iCIMS, Dayforce, Paylocity, Oracle, UKG's opportunity).
 * Never a lone UUID where UUIDs name the company. Learning a job's link
 * needs one.
 */
export function postingLevelId(url) {
  const u = parse(url);
  if (!u) return null;
  for (const [k, v] of u.searchParams) if (v && POSTING_PARAMS.has(k.toLowerCase())) return `${k.toLowerCase() === "vjk" ? "jk" : k.toLowerCase()}=${v.toLowerCase()}`;
  const host = hostOf(url);
  const path = u.pathname;
  const req = path.match(REQ);
  REQ.lastIndex = 0;
  if (req) return req[0].toLowerCase().replace(/^([a-z]+)[-_]/, "$1");
  const own = [
    [/(^|\.)greenhouse\.io$/, /\/jobs\/(\d{4,})/],
    [/(^|\.)lever\.co$/, /^\/[^/]+\/([0-9a-f-]{36})/i],
    [/(^|\.)ashbyhq\.com$/, /^\/[^/]+\/([0-9a-f-]{36})/i],
    [/(^|\.)workable\.com$/, /\/j\/([0-9a-z]{6,})/i],
    [/(^|\.)jobvite\.com$/, /\/job\/([0-9a-z]{6,})/i],
    [/(^|\.)smartrecruiters\.com$/, /^\/[^/]+\/(\d{6,})/],
    [/(^|\.)icims\.com$/, /\/jobs\/(\d{3,})\//],
    [/(^|\.)dayforcehcm\.com$/, /\/jobs\/(\d{3,})/i],
    [/(^|\.)paylocity\.com$/, /\/jobs\/(?:details|apply)\/(\d{3,})/i],
    [/\.oraclecloud\.com$/, /\/job\/(\d{3,})/i],
    [/(^|\.)ultipro\.(com|ca)$|\.rec\.pro\.ukg\.net$/, /\/opportunity(?:detail|apply)\/([0-9a-f-]{36})/i],
  ];
  for (const [h, p] of own) {
    if (!h.test(host)) continue;
    const m = p.exec(path);
    if (m) return m[1].toLowerCase();
  }
  // Elsewhere, a UUID in the path names the posting, unless the host uses them for the company.
  const uuid = !TENANT_UUIDS.test(host) && path.match(UUID);
  UUID.lastIndex = 0;
  return uuid ? uuid[0].toLowerCase() : null;
}

/**
 * The saved job one fill uses (spec 040): the page's own job; else the job
 * the user just picked in the panel for THIS page ("Fill with <job>'s…",
 * `pick`: {jobId, page, at}, good for 2 minutes); else none (the usual
 * résumé, no letter). Nothing is remembered past that one fill.
 */
export function fillJobFor(ownJobId, pick, url, now = Date.now()) {
  if (ownJobId) return ownJobId;
  if (!pick?.jobId || !isWebPage(url) || now - (pick.at || 0) > PICK_MS) return null;
  return pick.page === pageOf(url) ? pick.jobId : null;
}

/**
 * One page: its address without the #part, unless the #part is the page
 * (a "#/jobs/12345" route). Every step of an application is its own page.
 */
export function pageOf(url) {
  const u = parse(url);
  if (!u) return "";
  const route = u.hash.startsWith("#/") ? u.hash : "";
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}${route}`.toLowerCase();
}

/** The tabs map with one tab's entry set (or removed), newest last, capped. */
export function putEntry(map, tabId, entry) {
  const { [tabId]: _old, ...rest } = map || {};
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return entry ? { ...Object.fromEntries(kept), [tabId]: entry } : Object.fromEntries(kept);
}
