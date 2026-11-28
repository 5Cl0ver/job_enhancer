// Which saved job a tab is applying for when its page doesn't say (spec 040).
// PURE: unit-tested in test/files-and-tabs-040.spec.js.
//
// An application often leaves the job's own page: the job board's Apply
// opens the company's site (Dayforce, iCIMS…), and those pages rarely name
// the job. Job Catcher never guesses which job that is. Right after the user
// pressed an Apply on a saved job's own page (`press`, src/autofill/
// applyClick.js), the side panel asks "Applying for <job>?" on the next
// page that is no saved job by itself; only a Yes binds the tab to that job
// (its résumé, its cover letter, its Submit, its company link). The binding
// lasts while the tab stays on that application: its site (`siteOf`, tenant
// and all) and its posting (`postingIds`, strong ids first), 45 minutes
// idle. Anything else drops it; the question comes back only after a new
// press. When in doubt: the usual résumé and no letter.

import { applicantHost, isApplyUrl, siteKey } from "./autofill/hosts.js";

export const TAB_PRESS = "je_tab_press"; // tab → the press it holds
export const TAB_JOB = "je_tab_job"; // tab → the job the user said Yes to
export const BIND_MS = 45 * 60_000; // a press, and a binding, last this long idle
export const OPEN_MS = 20_000; // a tab opened this soon after a press inherits it
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
const STRONG_PARAMS = new Set(["jk", "vjk", "gh_jid", "ashby_jid", "career_job_req_id", "job", "jobid", "job_id", "jid", "req", "reqid", "requisitionid", "postingid", "jobreqid", "opportunityid", "jobpostingid", "positionid", "currentjobid"]);
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
 * The job to ask about on this page, else null: a press on that job's own
 * page in this tab (or the one that opened it) within 45 minutes, and this
 * page is no saved job by itself and surely an application (an applicant
 * system, an /apply page, or a careers page naming a posting) — never a
 * board, a search, a sign-in, a shop or a news page.
 */
export function askAbout(press, url, ownJobId, now = Date.now()) {
  if (!press?.jobId || now - (press.at || 0) > BIND_MS) return null;
  if (ownJobId || !isWebPage(url) || onHub(url) || isSignIn(url) || NOT_APPLICATION.test(hostOf(url))) return null;
  const ids = postingIds(url);
  const application = applicantHost(url) || isApplyUrl(url) || (looksLikeApplication(url) && (ids.strong.length || ids.weak.length));
  return application ? press.jobId : null;
}

/** A page's place: its path (no trailing /) and its #route. */
function placeOf(url) {
  const u = parse(url);
  if (!u) return { path: "", hash: "" };
  return { path: u.pathname.replace(/\/+$/, "").toLowerCase(), hash: u.hash.replace(/^#/, "").replace(/[?].*$/, "").toLowerCase() };
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

/** The binding the user's Yes makes on this page. */
export function bindHere(jobId, url, now = Date.now()) {
  const ids = postingIds(url);
  return { jobId, site: siteOf(url), places: [placeOf(url)], strong: ids.strong, nums: numbersOf(ids), at: now };
}

/**
 * What a page loaded in the bound tab does to the binding:
 * - "keep": surely the same posting (a strong id shared, or the Yes page
 *   itself or a step below it with no other posting's id); its 45 minutes
 *   restart;
 * - "same": a sign-in on the way, about:blank: nothing changes;
 * - "ask": the same company's site but not surely the same posting: the
 *   panel asks "Still applying for…?" (`asking`), the job unused till Yes;
 * - "drop": another site, another posting, or too long idle.
 */
export function judgeBinding(bound, url, now = Date.now()) {
  if (!bound?.jobId || now - (bound.at || 0) > BIND_MS) return { verdict: "drop", bound: null };
  if (!isWebPage(url) || isSignIn(url)) return { verdict: "same", bound };
  if (!bound.site || siteOf(url) !== bound.site) return { verdict: "drop", bound: null };
  const ids = postingIds(url);
  const nums = numbersOf(ids);
  const held = bound.nums || [];
  // Plain numbers: each side has one the other lacks.
  if (nums.length && held.length && nums.some((n) => !held.includes(n)) && held.some((n) => !nums.includes(n))) return { verdict: "drop", bound: null };
  const strong = bound.strong || [];
  const keep = () => {
    const merged = [...new Set([...strong, ...ids.strong])];
    const { asking: _a, ...rest } = bound;
    return { verdict: "keep", bound: { ...rest, strong: merged, nums: held.length ? held : nums, at: now } };
  };
  const here = placeOf(url);
  const ask = { verdict: "ask", bound: { ...bound, asking: here } };
  if (strong.length && ids.strong.length) {
    if (!overlap(strong, ids.strong)) return { verdict: "drop", bound: null };
    const before = named(strong);
    let fresh = false;
    for (const [k, v] of named(ids.strong)) {
      if (before.has(k) && before.get(k) !== v) return { verdict: "drop", bound: null };
      if (!before.has(k)) fresh = true;
    }
    // A posting part the Yes page didn't name (a board id shared, then an
    // opportunityId): not surely the same posting.
    return fresh ? ask : keep();
  }
  // A strong id where the Yes page had none: never taken on silently.
  if (ids.strong.length) return ask;
  const under = (bound.places || []).some((p) => p.hash === here.hash && (here.path === p.path || here.path.startsWith(`${p.path}/`)));
  return under ? keep() : ask;
}

/** Kept, or null (`judgeBinding` without asking: an unsure page is no binding). */
export function keepBinding(bound, url, now = Date.now()) {
  const { verdict, bound: next } = judgeBinding(bound, url, now);
  return verdict === "keep" || verdict === "same" ? next : null;
}

/** "Still applying for…? Yes" on this page: it becomes a place of the binding. */
export function confirmBinding(bound, url, now = Date.now()) {
  if (!bound?.jobId) return null;
  const ids = postingIds(url);
  const { asking: _a, ...rest } = bound;
  return { ...rest, places: [...(bound.places || []), placeOf(url)].slice(-20), strong: [...new Set([...(bound.strong || []), ...ids.strong])], nums: bound.nums?.length ? bound.nums : numbersOf(ids), at: now };
}

/** Is the binding asking about this page? */
export function askingHere(bound, url) {
  if (!bound?.asking) return false;
  const here = placeOf(url);
  return bound.asking.path === here.path && bound.asking.hash === here.hash;
}

/** The job bound to this page, else null (read-only; never while asking). */
export function boundJobId(bound, url, now = Date.now()) {
  if (!isWebPage(url) || isSignIn(url) || askingHere(bound, url)) return null;
  const { verdict, bound: next } = judgeBinding(bound, url, now);
  return verdict === "keep" || verdict === "same" ? next?.jobId || null : null;
}

/** The tabs map with one tab's entry set (or removed), newest last, capped. */
export function putEntry(map, tabId, entry) {
  const { [tabId]: _old, ...rest } = map || {};
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return entry ? { ...Object.fromEntries(kept), [tabId]: entry } : Object.fromEntries(kept);
}
