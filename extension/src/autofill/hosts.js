// The applicant systems people really apply through (spec 016, research R6):
// one list for the page (is this an application?) and the side panel (what
// site is this?). PURE: unit-tested in test/fill-engine.spec.js and
// test/panel-context.spec.js.

/**
 * @typedef {{name: string, host: RegExp, path?: RegExp, autoTracked?: boolean}} ApplicantHost
 * `path`, when set, must match too (the host also serves other pages).
 * `autoTracked`: submitting is known to be tracked as applied.
 * @type {ApplicantHost[]}
 */
export const APPLICANT_HOSTS = [
  { name: "Workday", host: /\.(myworkdayjobs|myworkdaysite)\.com$/i, autoTracked: true },
  { name: "Greenhouse", host: /(^|\.)greenhouse\.io$/i, autoTracked: true },
  { name: "Lever", host: /(^|\.)lever\.co$/i, autoTracked: true },
  { name: "Ashby", host: /(^|\.)ashbyhq\.com$/i },
  { name: "iCIMS", host: /(^|\.)icims\.com$/i },
  { name: "SmartRecruiters", host: /(^|\.)smartrecruiters\.com$/i },
  { name: "Jobvite", host: /(^|\.)jobvite\.com$/i },
  { name: "Workable", host: /(^|\.)workable\.com$/i },
  { name: "Taleo", host: /(^|\.)taleo\.net$/i },
  { name: "SuccessFactors", host: /successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$/i },
  { name: "Paycom", host: /(^|\.)paycomonline\.(net|com)$/i, path: /\/(v4\/)?ats\b/i },
  { name: "Paylocity", host: /(^|\.)paylocity\.com$/i, path: /\/recruiting\b/i },
  { name: "UKG", host: /(^|\.)ultipro\.(com|ca)$|\.rec\.pro\.ukg\.net$/i },
  { name: "ADP", host: /^workforcenow\.adp\.com$/i, path: /\/mascsr\b|recruit/i },
  { name: "ADP", host: /^(myjobs|recruiting|tcs)\.adp\.com$/i },
  { name: "Dayforce", host: /(^|\.)dayforcehcm\.com$/i, path: /\/jobs\b|\/candidateportal\b|\/apply\b|^\/[a-z]{2}-[a-z]{2}\//i },
  { name: "BambooHR", host: /\.bamboohr\.com$/i, path: /\/(careers|jobs)\b/i },
  { name: "JazzHR", host: /\.applytojob\.com$/i },
  { name: "Breezy", host: /\.breezy\.hr$/i },
  { name: "Recruitee", host: /\.recruitee\.com$/i },
  { name: "Rippling", host: /^ats\.rippling\.com$|\.rippling-ats\.com$/i },
  { name: "Oracle", host: /\.oraclecloud\.com$/i, path: /candidateexperience|\/hcmui\//i },
  { name: "Avature", host: /\.avature\.net$/i },
  { name: "Eightfold", host: /\.eightfold\.ai$/i },
  { name: "BrassRing", host: /\.brassring\.com$/i },
  { name: "Pinpoint", host: /\.pinpointhq\.com$/i },
  { name: "TriNet Hire", host: /^app\.trinethire\.com$/i },
];

// Hosts that serve many companies' applications: the company is in the path.
const SHARED_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|jobvite\.com|applytojob\.com|breezy\.hr)$/i;

/**
 * Which site a taught box belongs to: the host — plus the company's path on
 * hosts that serve many companies (boards.greenhouse.io/vellacor), so one
 * company's answers never fill another's boxes.
 */
export function siteKey(url) {
  try {
    const u = new URL(url);
    if (SHARED_HOSTS.test(u.hostname)) return `${u.hostname}/${u.pathname.split("/")[1] || ""}`;
    // Paycom and ADP serve every company from one host: the company is the
    // portal key in the address (…/portal/<key>/… or ?clientkey=, ?cid=).
    if (/(^|\.)paycomonline\.(net|com)$/i.test(u.hostname)) {
      const key = u.searchParams.get("clientkey") || (/\/portal\/([^/]+)/i.exec(u.pathname) || [])[1];
      return key ? `${u.hostname}/${key}` : u.hostname;
    }
    if (/^workforcenow\.adp\.com$/i.test(u.hostname) && u.searchParams.get("cid")) return `${u.hostname}/${u.searchParams.get("cid")}`;
    return u.hostname;
  } catch {
    return "";
  }
}

// Address parts that name ONE posting (or the company it belongs to) on job
// sites whose path is the same for every job.
const ID_PARAMS = ["gh_jid", "ashby_jid", "jk", "job", "jobid", "job_id", "jid", "id", "req", "reqid", "requisitionid", "postingid", "jobreqid", "clientkey", "cid", "ccid", "for", "token"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Which job POSTING an address is, so a page is only ever linked to the saved
 * job it really is — never to another job on the same applicant system.
 * `scope` is the system (or the host) the key belongs to; two addresses in
 * the same scope with different keys are different postings. The job board
 * and its apply page give the same key (…/jobs/42 and …/jobs/42/apply).
 * Null when the address can't tell one posting from another.
 * @returns {{scope: string, key: string, sure: boolean} | null}
 */
export function postingKey(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname;
  const q = (name) => {
    for (const [k, v] of u.searchParams) if (k.toLowerCase() === name && v) return v;
    return "";
  };
  // A system's own posting id: two of these in one scope that differ are
  // surely two postings (`sure`). A plain address is only a hint.
  const own = (scope, id) => ({ scope, key: `${scope}:${String(id).toLowerCase()}`, sure: true });

  // Greenhouse job ids are unique across every company: the board, its
  // embed (?token=) and a company's own careers page (?gh_jid=) all agree.
  const gh = q("gh_jid") || (/(^|\.)greenhouse\.io$/.test(host) && (/\/jobs\/(\d+)/.exec(path)?.[1] || (/\/embed\/job_app/.test(path) && q("token"))));
  if (gh && /^\d+$/.test(gh)) return own("greenhouse", gh);
  const ashby = q("ashby_jid") || (/(^|\.)ashbyhq\.com$/.test(host) && UUID.exec(path)?.[0]);
  if (ashby) return own("ashby", ashby);
  if (/(^|\.)lever\.co$/.test(host) && UUID.test(path)) return own("lever", UUID.exec(path)[0]);
  if (/(^|\.)smartrecruiters\.com$/.test(host) && /\/(\d{6,})(?=[-/]|$)/.test(path)) return own("smartrecruiters", /\/(\d{6,})(?=[-/]|$)/.exec(path)[1]);
  if (/(^|\.)workable\.com$/.test(host) && /\/j\/([0-9a-z]+)/i.test(path)) return own("workable", /\/j\/([0-9a-z]+)/i.exec(path)[1]);
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(path)?.[1] || q("currentjobid");
    return id ? own("linkedin", id) : null;
  }
  // Workday: one tenant per host, the requisition id ends the job's path
  // (…/job/Portland-OR/IT-Analyst_JR-1234/apply).
  if (/\.(myworkdayjobs|myworkdaysite)\.com$/.test(host)) {
    const job = /\/job\/(.+)$/i.exec(path.replace(/\/+$/, "").replace(/\/(apply|application)(\/.*)?$/i, ""))?.[1] || "";
    const last = job.split("/").pop() || "";
    const req = last.includes("_") ? last.slice(last.lastIndexOf("_") + 1) : "";
    return req ? own(`workday:${host}`, req) : null;
  }
  // Anywhere else: the address itself, without "/apply" on the end — but only
  // when it names one posting (an id in the path or the query, or a job's
  // slug like /careers/it-support-analyst), not a careers home page.
  const clean = path.toLowerCase().replace(/\/+$/, "").replace(/\/(apply|application|applications)$/, "");
  const ids = ID_PARAMS.filter((p) => q(p)).map((p) => `${p}=${q(p).toLowerCase()}`);
  const parts = clean.split("/").filter(Boolean);
  const named = /\d/.test(clean) || UUID.test(clean) || (parts.length >= 2 && /-/.test(parts[parts.length - 1]));
  if (!ids.length && !named) return null;
  return { scope: host, key: `${host}${clean}${ids.length ? `?${ids.join("&")}` : ""}`, sure: false };
}

/** Can one company be told from another here? Not on Indeed's or LinkedIn's apply pages. */
export function companyKnown(url) {
  try {
    return !/(^|\.)(smartapply\.indeed\.com|apply\.indeed\.com|linkedin\.com)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The applicant system an address belongs to, or null. */
export function applicantHost(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return APPLICANT_HOSTS.find((h) => h.host.test(u.hostname) && (!h.path || h.path.test(u.pathname))) || null;
}

/** An address that is an application form: an applicant system, or a path with "apply". */
export function isApplyUrl(url) {
  if (applicantHost(url)) return true;
  try {
    const u = new URL(url);
    if (/smartapply\.indeed\.com$/i.test(u.hostname)) return true;
    // A path part that IS the word ("/apply", "/apply-now", "/application/2"),
    // not an article about one ("/applications-open").
    return /\/(apply|application|applications|candidate)(?=\/|$|[-_]?now\b|\.)/i.test(u.pathname);
  } catch {
    return false;
  }
}
