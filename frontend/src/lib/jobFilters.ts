/**
 * My Jobs list filters (pure, shared by the desktop card list and the phone
 * row list).
 */
import type { SavedJob } from "@/types/api";

export type AppliedFilter = "all" | "applied" | "not";

export interface JobFilters {
  /** Words to find in the title or company. */
  q: string;
  loc: string;
  /** Lowest yearly pay to show; 0 for any. */
  minPay: number;
  /** A job type, or "all". */
  jobType: string;
  applied: AppliedFilter;
  remoteOnly: boolean;
}

export const NO_FILTERS: JobFilters = {
  q: "",
  loc: "",
  minPay: 0,
  jobType: "all",
  applied: "all",
  remoteOnly: false,
};

export const PAY_OPTIONS = [
  { label: "Any pay", value: 0 },
  { label: "$50k+", value: 50_000 },
  { label: "$75k+", value: 75_000 },
  { label: "$100k+", value: 100_000 },
  { label: "$125k+", value: 125_000 },
  { label: "$150k+", value: 150_000 },
];

const HOURS_PER_YEAR = 2080;

export function filterJobs(jobs: SavedJob[], f: JobFilters): SavedJob[] {
  const q = f.q.trim().toLowerCase();
  const loc = f.loc.trim().toLowerCase();
  return jobs.filter((sj) => {
    const j = sj.job_listing;
    if (q && !`${j.title} ${j.company}`.toLowerCase().includes(q)) return false;
    if (f.remoteOnly && !j.is_remote) return false;
    if (f.applied === "applied" && !sj.applied_at) return false;
    if (f.applied === "not" && sj.applied_at) return false;
    if (f.minPay > 0) {
      const pay = j.salary_max ?? j.salary_min ?? 0;
      const yearly = j.salary_period === "hourly" ? pay * HOURS_PER_YEAR : pay;
      if (yearly < f.minPay) return false;
    }
    if (f.jobType !== "all" && (j.job_type || "").toLowerCase() !== f.jobType.toLowerCase())
      return false;
    if (loc && !(j.location || "").toLowerCase().includes(loc)) return false;
    return true;
  });
}

/** How many filters are set, not counting the search text. */
export function filtersSet(f: JobFilters): number {
  return (
    Number(!!f.loc.trim()) +
    Number(f.minPay > 0) +
    Number(f.jobType !== "all") +
    Number(f.applied !== "all") +
    Number(f.remoteOnly)
  );
}

/** The job types present in a list, for the type filter's choices. */
export function jobTypesIn(jobs: SavedJob[]): string[] {
  return [...new Set(jobs.map((s) => s.job_listing.job_type).filter(Boolean))].sort() as string[];
}

/** How many of `jobs` sit in each stage. */
export function stageCounts(jobs: SavedJob[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sj of jobs) {
    if (sj.pipeline_stage_id) {
      counts.set(sj.pipeline_stage_id, (counts.get(sj.pipeline_stage_id) ?? 0) + 1);
    }
  }
  return counts;
}
