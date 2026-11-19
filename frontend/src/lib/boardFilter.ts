/**
 * Board search and column slicing (pure, so it's cheap to run on every
 * keystroke and easy to test).
 *
 * Search looks at a job's title and company. While a search is on, matches
 * move to the top of their column and the rest dim, so a card can be found in
 * a column of hundreds without scrolling for it.
 */
import type { SavedJob } from "@/types/api";

/** Cards a column renders at first, and how many more each "Show more" adds. */
export const PAGE_SIZE = 30;

export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word of the search appears in the job's title or company. */
export function matchesSearch(job: SavedJob, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = `${job.job_listing.title} ${job.job_listing.company}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

export interface ColumnView {
  /** Cards to render, matches first while searching. */
  visible: SavedJob[];
  /** How many of the column's jobs match the search (all of them with none). */
  matches: number;
  /** Jobs not rendered yet. */
  hidden: number;
}

/**
 * What one column shows: at most `limit` cards, except that every search match
 * is always shown (a match must never hide behind "Show more").
 */
export function columnView(jobs: SavedJob[], words: string[], limit: number): ColumnView {
  if (words.length === 0) {
    const visible = jobs.slice(0, limit);
    return { visible, matches: jobs.length, hidden: jobs.length - visible.length };
  }
  const hits = jobs.filter((j) => matchesSearch(j, words));
  const rest = jobs.filter((j) => !matchesSearch(j, words));
  const visible = [...hits, ...rest.slice(0, Math.max(0, limit - hits.length))];
  return { visible, matches: hits.length, hidden: jobs.length - visible.length };
}

/**
 * The stage column a job belongs in. A job with no stage, or one whose stage
 * was deleted, goes in the first column instead of vanishing from the board.
 */
export function stageFor(job: SavedJob, stageIds: string[]): string | null {
  if (job.pipeline_stage_id && stageIds.includes(job.pipeline_stage_id)) {
    return job.pipeline_stage_id;
  }
  return stageIds[0] ?? null;
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Split `text` into plain and matched pieces, for marking search hits. */
export function highlightParts(text: string, words: string[]): TextPart[] {
  if (words.length === 0 || !text) return [{ text, hit: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: words.includes(part.toLowerCase()) }));
}
