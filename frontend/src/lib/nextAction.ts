import { differenceInDays } from "date-fns";
import type { SavedJob } from "@/types/api";

/**
 * The CRM "brain": given a job's state, what should the user do next?
 *
 * Pure and dependency-light so it's trivially testable and can run on every
 * card. It reads only data the app already stores (applied_at, emailed_at,
 * last_stage_change) plus the card's stage NAME — no backend call. As email
 * auto-status lands later, the same signals get set automatically and this
 * logic keeps working unchanged.
 */

export type NextActionTone = "do" | "prep" | "wait" | "win";

export interface NextAction {
  /** Short CTA shown on the card, e.g. "Send outreach email". */
  label: string;
  /** Visual urgency: do = act now, prep = get ready, wait = pending, win = good news. */
  tone: NextActionTone;
}

// Stage-name buckets. Matches the built-in stages and common custom names.
const TERMINAL = /reject|declin|withdraw|ghost|no longer|not moving|closed|pass/i;
const WON = /offer|hired|accepted/i;
const INTERVIEW =
  /interview|phone\s*screen|screen|onsite|on-?site|take[-\s]?home|coding|technical|final|assessment/i;
const APPLIED = /applied|submitted|in\s*review|under\s*review/i;

/**
 * Compute the single most important next step for a job. Returns null when
 * there's nothing to nudge (e.g. a rejected job).
 */
export function getNextAction(
  sj: SavedJob,
  opts: { followUpDays: number; stageName: string | null },
): NextAction | null {
  const stage = (opts.stageName ?? "").toLowerCase();
  const sinceStage = differenceInDays(new Date(), new Date(sj.last_stage_change));

  // Good news / dead ends first.
  if (WON.test(stage)) return { label: "🎉 Offer — respond", tone: "win" };
  if (TERMINAL.test(stage)) return null;

  // In an interview loop → prep is the move (dates come from email later).
  if (INTERVIEW.test(stage)) return { label: "Prep for interview", tone: "prep" };

  const hasApplied = sj.applied_at != null || APPLIED.test(stage);

  if (hasApplied) {
    // Applied but haven't reached out to a human yet.
    if (!sj.emailed_at) return { label: "Send outreach email", tone: "do" };
    // Reached out — are they ghosting?
    if (sinceStage >= opts.followUpDays) {
      return { label: `No reply in ${sinceStage}d — follow up`, tone: "do" };
    }
    return { label: "Waiting on reply", tone: "wait" };
  }

  // Saved but not applied. Nudge stale ones to move or clear out.
  if (sinceStage >= opts.followUpDays) return { label: "Apply or archive", tone: "do" };
  return { label: "Apply", tone: "prep" };
}

/** Tailwind classes for each tone — used by the card pill. */
export const TONE_STYLES: Record<NextActionTone, string> = {
  do: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  prep: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  wait: "bg-muted text-muted-foreground",
  win: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};
