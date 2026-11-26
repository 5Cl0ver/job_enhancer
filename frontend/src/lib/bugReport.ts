/**
 * Bug reports (spec 030): a problem Claude ran into, as clean Markdown to
 * paste into a chat with Claude so it can fix the cause. Pure functions.
 */
import { type ApplyProblem, PROBLEM_KIND } from "@/lib/apply";

/** "2026-11-25 10:07 UTC": the same for everyone who reads it. */
export function utcTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const siteOf = (p: ApplyProblem) => {
  if (p.site) return p.site;
  try {
    return p.page ? new URL(p.page).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** One report: "# Bug report: <kind> on <site>", its context, what
 * happened and the page. `level` 2 nests it under a heading. */
export function bugReport(p: ApplyProblem, level: 1 | 2 = 1): string {
  const h = "#".repeat(level);
  const site = siteOf(p);
  const when = utcTime(p.at) + (p.count > 1 ? ` (${p.count} times)` : "");
  const lines = [
    `${h} Bug report: ${PROBLEM_KIND[p.kind] ?? "Other"}${site ? ` on ${site}` : ""}`,
    "",
    `- Run: ${p.run_id ?? "unknown"}`,
    `- Job: ${p.job || "unknown"}`,
    `- Site: ${site || "unknown"}`,
    `- Job Catcher: ${p.job_catcher || "unknown"}`,
    `- Playbook: ${p.playbook || "unknown"}`,
    `- When: ${when}`,
    "",
    `${h}# What happened`,
    "",
    p.what,
    "",
    `${h}# Page`,
    "",
    p.page || "unknown",
  ];
  return lines.join("\n");
}

/** Every open report under one heading with a count. */
export function allOpenReport(problems: ApplyProblem[]): string {
  const open = problems.filter((p) => (p.status ?? "open") === "open");
  const head = `# Open bug reports (${open.length})`;
  return [head, ...open.map((p) => bugReport(p, 2))].join("\n\n");
}
