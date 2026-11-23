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
