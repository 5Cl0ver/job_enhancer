import { useMemo, useState } from "react";
import { BookmarkX, SlidersHorizontal, X } from "lucide-react";
import { CollectionSidebar } from "@/components/jobs/CollectionSidebar";
import { JobCard } from "@/components/jobs/JobCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSavedJobs, useUnsaveJob } from "@/hooks/useSavedJobs";

type AppliedFilter = "all" | "applied" | "not";

const PAY_OPTIONS = [
  { label: "Any pay", value: 0 },
  { label: "$50k+", value: 50_000 },
  { label: "$75k+", value: 75_000 },
  { label: "$100k+", value: 100_000 },
  { label: "$125k+", value: 125_000 },
  { label: "$150k+", value: 150_000 },
];

const inputCls =
  "h-9 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/** The saved-jobs list (collections + filters + card grid). Shared by the
 *  "List" view of the combined My Jobs page. */
export function SavedJobsBody() {
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const { data: savedJobs = [], isLoading, isError } = useSavedJobs({
    collectionId: selectedCollection ?? undefined,
  });
  const unsaveJob = useUnsaveJob();

  // --- Filters ---
  const [q, setQ] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [applied, setApplied] = useState<AppliedFilter>("all");
  const [minPay, setMinPay] = useState(0);
  const [jobType, setJobType] = useState("all");
  const [loc, setLoc] = useState("");

  // Job-type choices come from what's actually in the list.
  const jobTypes = useMemo(
    () =>
      [...new Set(savedJobs.map((s) => s.job_listing.job_type).filter(Boolean))].sort() as string[],
    [savedJobs],
  );

  const filtered = useMemo(() => {
    return savedJobs.filter((sj) => {
      const j = sj.job_listing;
      if (q) {
        const hay = `${j.title} ${j.company}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      if (remoteOnly && !j.is_remote) return false;
      if (applied === "applied" && !sj.applied_at) return false;
      if (applied === "not" && sj.applied_at) return false;
      if (minPay > 0) {
        const pay = j.salary_max ?? j.salary_min ?? 0;
        const yearly = j.salary_period === "hourly" ? pay * 2080 : pay;
        if (yearly < minPay) return false;
      }
      if (jobType !== "all" && (j.job_type || "").toLowerCase() !== jobType.toLowerCase())
        return false;
      if (loc && !(j.location || "").toLowerCase().includes(loc.toLowerCase())) return false;
      return true;
    });
  }, [savedJobs, q, remoteOnly, applied, minPay, jobType, loc]);

  const activeFilters =
    !!q || remoteOnly || applied !== "all" || minPay > 0 || jobType !== "all" || !!loc;
  const clearFilters = () => {
    setQ("");
    setRemoteOnly(false);
    setApplied("all");
    setMinPay(0);
    setJobType("all");
    setLoc("");
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <CollectionSidebar selectedId={selectedCollection} onSelect={setSelectedCollection} />

      <main className="min-w-0 flex-1">
        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <input
            className={`${inputCls} w-full min-w-[160px] sm:w-auto sm:flex-1`}
            placeholder="Search title or company…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <input
            className={`${inputCls} w-32`}
            placeholder="Location / state"
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
          />
          <select className={inputCls} value={minPay} onChange={(e) => setMinPay(Number(e.target.value))}>
            {PAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {jobTypes.length > 0 && (
            <select className={inputCls} value={jobType} onChange={(e) => setJobType(e.target.value)}>
              <option value="all">Any type</option>
              {jobTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <select
            className={inputCls}
            value={applied}
            onChange={(e) => setApplied(e.target.value as AppliedFilter)}
          >
            <option value="all">All</option>
            <option value="not">Not applied</option>
            <option value="applied">Applied</option>
          </select>
          <button
            type="button"
            onClick={() => setRemoteOnly((v) => !v)}
            className={`h-9 rounded-md border px-3 text-sm font-medium ${
              remoteOnly
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            Remote
          </button>
          {activeFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
            Failed to load saved jobs.
          </div>
        ) : savedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <BookmarkX className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-lg font-medium">No saved jobs yet</p>
            <p className="text-sm text-muted-foreground">
              Search for jobs and save the ones you like.
            </p>
            <Button variant="outline" asChild>
              <a href="/search">Find jobs</a>
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">No jobs match these filters.</p>
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              Showing {filtered.length} of {savedJobs.length}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {filtered.map((sj) => (
                <JobCard
                  key={sj.id}
                  job={sj.job_listing}
                  isSaved
                  applied={!!sj.applied_at}
                  savedJobId={sj.id}
                  onSave={() => unsaveJob.mutate(sj.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
