// What the user is doing in the tab the panel is beside. Pure (URL + title in,
// a context out) so it's unit-tested: test/panel-context.spec.js.
import { applicantHost } from "../../../src/autofill/hosts.js";

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

/** The saved job this tab is most likely about: its title is in the tab's title. */
export function bestJobMatch(tabTitle: string, jobs: SavedJob[]): SavedJob | null {
  const t = (tabTitle || "").toLowerCase();
  if (!t) return null;
  return jobs.find((j) => j.title && t.includes(j.title.toLowerCase())) || null;
}

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A saved job that looks like this one: same company, same or contained title. */
export function findDuplicate(job: { title: string; company: string }, jobs: SavedJob[]): SavedJob | null {
  const t = norm(job.title);
  const c = norm(job.company);
  if (!t || !c) return null;
  return (
    jobs.find((j) => {
      if (norm(j.company) !== c) return false;
      const jt = norm(j.title);
      return jt === t || jt.includes(t) || t.includes(jt);
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
