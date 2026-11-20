/**
 * How a saved job got into My Jobs (pure). The server records it when the job
 * is saved; older jobs it can't place have none, and show no label.
 */
import type { SavedJob } from "@/types/api";

export const ORIGINS = ["scout", "email", "extension", "claude", "search", "manual"] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABEL: Record<Origin, string> = {
  scout: "Claude Scout",
  email: "From an email",
  extension: "Job Catcher",
  claude: "Saved by Claude",
  search: "Job board search",
  manual: "Added by you",
};

type HasOrigin = Pick<SavedJob, "origin" | "scout">;

export function originOf(sj: Pick<SavedJob, "origin">): Origin | null {
  return ORIGINS.includes(sj.origin as Origin) ? (sj.origin as Origin) : null;
}

/** The short label for a card or row, with Claude's fit score on Scout's jobs. */
export function originText(sj: HasOrigin): string | null {
  const origin = originOf(sj);
  if (!origin) return null;
  const label = ORIGIN_LABEL[origin];
  return origin === "scout" && sj.scout ? `${label} · fit ${sj.scout.fit_score}/10` : label;
}

/** The origins present in a list, in a fixed order, for the filter's choices. */
export function originsIn(jobs: Pick<SavedJob, "origin">[]): Origin[] {
  const seen = new Set(jobs.map((sj) => sj.origin));
  return ORIGINS.filter((o) => seen.has(o));
}

/** The filter's choices: the origins in the list, plus the one chosen even if
 * this list has none of it (so the picker never shows a different answer from
 * the one in force). */
export function originChoices(jobs: Pick<SavedJob, "origin">[], chosen: string): Origin[] {
  const seen = new Set<string | null | undefined>(jobs.map((sj) => sj.origin));
  seen.add(chosen);
  return ORIGINS.filter((o) => seen.has(o));
}

/** My Jobs opened on one collection: the link other pages use. */
export function folderLink(collectionId: string): string {
  return `/jobs?folder=${encodeURIComponent(collectionId)}`;
}

/** Scout's History opened on one run. */
export function runLink(runId: string): string {
  return `/search?tab=scout&view=history&run=${encodeURIComponent(runId)}`;
}
