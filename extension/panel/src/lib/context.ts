// What the user is doing in the tab the panel is beside. Pure (URL + title in,
// a context out) so it's unit-tested: test/panel-context.spec.js.
import { applicantHost, postingKey } from "../../../src/autofill/hosts.js";

export type PageContext =
  | { kind: "none" }
  | { kind: "indeed-myjobs" }
  | { kind: "application"; site: string; autoTracked: boolean; indeed: boolean }
  | { kind: "page"; site: string };

export interface SavedJob {
  id: string;
  job_listing_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  applied: boolean;
}

/** A friendly site name from a host: "www.amazon.jobs" → "Amazon". */
export function siteLabel(host: string): string {
  const skip = new Set(["www", "jobs", "careers", "career", "boards", "job-boards", "apply", "account", "my"]);
  const name =
    host
      .replace(/^www\./, "")
      .split(".")
      .find((p) => !skip.has(p) && p.length > 1) || host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function detectContext(url: string): PageContext {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "none" };
  }
  if (!/^https?:$/.test(u.protocol)) return { kind: "none" };
  const host = u.hostname;
  const path = u.pathname;
  // Indeed "My jobs": a whole list of applications to sync.
  if (/(^|\.)myjobs\.indeed\.com$/i.test(host) || (/indeed\./i.test(host) && /\/myjobs/.test(path)))
    return { kind: "indeed-myjobs" };
  if (/smartapply\.indeed\.com$/i.test(host) || (/indeed\./i.test(host) && /\bapply\b/i.test(url)))
    return { kind: "application", site: "Indeed", autoTracked: false, indeed: true };
  if (/greenhouse\.io$/i.test(host))
    return { kind: "application", site: "Greenhouse", autoTracked: true, indeed: false };
  if (/(^|\.)lever\.co$/i.test(host))
    return { kind: "application", site: "Lever", autoTracked: true, indeed: false };
  if (/\.myworkdayjobs\.com$/i.test(host) && /\b(apply|application)/i.test(path))
    return { kind: "application", site: "Workday", autoTracked: true, indeed: false };
  // The other applicant systems (Paycom, Paylocity, UKG, ADP…): one list,
  // shared with the page (src/autofill/hosts.js). Workday's job listings
  // aren't applications: only its apply path (above) is.
  const system = applicantHost(url);
  if (system && system.name !== "Workday")
    return { kind: "application", site: system.name, autoTracked: !!system.autoTracked, indeed: false };
  // Any other site whose PATH is an application form (Amazon Jobs, company
  // careers pages). Path only, so job listings don't count.
  if (/\b(apply|application)/i.test(path))
    return { kind: "application", site: siteLabel(host), autoTracked: false, indeed: false };
  return { kind: "page", site: siteLabel(host) };
}

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** `needle` as whole words in `hay`: "Software Engineer I" is not in "Software Engineer II". */
const hasWords = (hay: string, needle: string) => {
  const n = norm(needle);
  return !!n && ` ${norm(hay)} `.includes(` ${n} `);
};

const companyCore = (c: string) => norm(c).replace(/\s+(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|lp)$/, "");

/** The company named in the tab's title, or in its address (affirm.wd5…, /affirm/jobs/…). */
function companyOnPage(page: { url: string; title: string }, company: string): boolean {
  const core = companyCore(company);
  if (!core || COMMON.has(core)) return false;
  let host = "";
  let parts: string[] = [];
  try {
    const u = new URL(page.url);
    host = u.hostname.toLowerCase();
    parts = [...host.split("."), ...u.pathname.split("/")].map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, ""));
  } catch {
    return false;
  }
  // A job site's own name on that site ("Indeed" on indeed.com, "Greenhouse
  // Software" on greenhouse.io) is its branding, not proof of the employer:
  // drop the site's name off the tab title's end and don't read the address.
  const first = core.split(" ")[0];
  const own = !!SITES[first]?.test(host);
  const title = own ? page.title.replace(new RegExp(`\\s*[|\\-\u2013\u2014]\\s*${first}(\\.com)?\\s*$`, "i"), "") : page.title;
  if (hasWords(title, core)) return true;
  if (own) return false;
  const flat = core.replace(/ /g, "");
  if (flat.length < 4) return false;
  // "Vellacor Robotics" on vellacor.wd5.myworkdayjobs.com: its distinctive first word.
  const firstOk = core.includes(" ") && first.length >= 5 && !COMMON.has(first);
  return parts.some((p) => p === flat || (flat.length >= 5 && p.startsWith(flat)) || (firstOk && p === first));
}

// Job sites, by the name they brand their pages with.
const SITES: Record<string, RegExp> = {
  indeed: /(^|\.)indeed\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  greenhouse: /(^|\.)greenhouse\.io$/,
  lever: /(^|\.)lever\.co$/,
  ashby: /(^|\.)ashbyhq\.com$/,
  workday: /\.(myworkdayjobs|myworkdaysite)\.com$/,
  glassdoor: /(^|\.)glassdoor\.com$/,
  ziprecruiter: /(^|\.)ziprecruiter\.com$/,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/,
  workable: /(^|\.)workable\.com$/,
};

// Words that are on job pages whatever the company: never proof of one.
const COMMON = new Set(["remote", "hybrid", "onsite", "jobs", "job", "hiring", "global", "united", "american", "national", "first", "general", "international", "north", "south", "pacific", "atlantic", "health", "group", "services", "solutions", "systems", "careers", "digital", "premier", "advanced", "western", "eastern", "central", "southern", "northern"]);

/**
 * The saved job this tab is about — or null. Never a guess on a shared
 * applicant system: the same posting (same address, or the same job id on
 * Greenhouse, Lever, Workday…) wins; otherwise the saved job's whole title AND
 * its company must be on the page, and a saved job that is a different posting
 * on the same system never counts. `notThis`: saved jobs the user said aren't
 * this page. `pinned`: the job the user saved from this very page, which wins.
 */
export function bestJobMatch(
  page: { url: string; title: string },
  jobs: SavedJob[],
  notThis: string[] = [],
  pinned?: string,
): SavedJob | null {
  let pool = jobs.filter((j) => !notThis.includes(j.id));
  const here = postingKey(page.url);
  // Only an address that is surely one posting can hold a pin: a careers page
  // listing many jobs, or #/job/42 vs #/job/43, can't.
  const mine = pinned && here?.sure ? pool.find((j) => j.id === pinned) : undefined;
  if (mine) return mine;
  let sameSure: SavedJob[] = [];
  if (here) {
    const same = pool.filter((j) => postingKey(j.url)?.key === here.key);
    if (same.length === 1) return same[0];
    if (here.sure) sameSure = same;
    // Several saved from one address (a careers page listing many jobs): the
    // title and company decide between them.
    if (same.length > 1) pool = same;
  }
  const fits = pool.filter((j) => {
    if (!j.title || !j.company) return false;
    const theirs = postingKey(j.url);
    if (here?.sure && theirs?.sure && theirs.scope === here.scope && theirs.key !== here.key) return false;
    return hasWords(page.title, j.title) && companyOnPage(page, j.company);
  });
  // The most specific title wins ("Software Engineer II" over "Software Engineer").
  // One posting saved more than once: any of them is this page.
  return fits.sort((a, b) => norm(b.title).length - norm(a.title).length)[0] || sameSure[0] || null;
}

/** A saved job that looks like this one: same company, same or contained title (whole words). */
export function findDuplicate(job: { title: string; company: string }, jobs: SavedJob[]): SavedJob | null {
  const t = norm(job.title);
  const c = norm(job.company);
  if (!t || !c) return null;
  return (
    jobs.find((j) => {
      if (norm(j.company) !== c) return false;
      return hasWords(j.title, t) || hasWords(t, j.title);
    }) || null
  );
}

/**
 * The file name employers see for a document: built from the user's own résumé
 * file name ("Wren_Calloway_Resume.pdf" → "Wren_Calloway_Cover_Letter.pdf").
 */
export function downloadFilename(resumeFilename: string, docType: "cover_letter" | "resume"): string {
  let base = (resumeFilename || "").replace(/\.[^.]+$/, "");
  base = base.replace(/[\\/:*?"<>|]+/g, "").trim();
  const person = base.replace(/[_\-\s]*(resume|cv|c\.v\.)$/i, "").trim() || base;
  const label = docType === "resume" ? "Resume" : "Cover_Letter";
  if (person) return `${person.replace(/\s+/g, "_")}_${label}.pdf`;
  return docType === "resume" ? "Resume.pdf" : "Cover_Letter.pdf";
}
