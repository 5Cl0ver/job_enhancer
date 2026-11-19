/**
 * My Jobs on a phone: short rows you can scan with a thumb (about ten to a
 * screen), stage chips with counts in place of the board's columns, one search
 * box, and the filters in a sheet behind one button. Rows are drawn a page at
 * a time. The desktop's card list is SavedJobsBody.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookmarkX, Search, SlidersHorizontal, X } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { CountBadge } from "@/components/layout/PhoneNav";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollections, useSavedJobs } from "@/hooks/useSavedJobs";
import { useShowMore } from "@/hooks/useShowMore";
import { usePipelineStages } from "@/hooks/useTracker";
import {
  NO_FILTERS,
  PAY_OPTIONS,
  filterJobs,
  filtersSet,
  jobTypesIn,
  stageCounts,
  type AppliedFilter,
  type JobFilters,
} from "@/lib/jobFilters";
import { readPref, writePref } from "@/lib/prefs";
import { stageTone } from "@/lib/stageStyle";
import { cn } from "@/lib/utils";
import type { SavedJob } from "@/types/api";

const ALL = "all";

// Native pickers: the phone's own wheel is easier than a custom menu.
const FIELD =
  "h-11 w-full rounded-md border bg-background px-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground active:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function JobRow({ savedJob, stageName }: { savedJob: SavedJob; stageName: string | null }) {
  const j = savedJob.job_listing;
  const where = [j.company, j.is_remote ? "Remote" : j.location].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        to={`/jobs/${j.id}`}
        className="-mx-4 flex min-h-16 items-center gap-3 px-4 py-2.5 active:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-snug">{j.title}</p>
          <p className="truncate text-sm text-muted-foreground">{where}</p>
        </div>
        {j.is_expired ? (
          <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
            Expired
          </span>
        ) : (
          stageName && (
            <span
              className={cn(
                "max-w-[40%] shrink-0 truncate rounded-full px-2 py-0.5 text-xs font-medium",
                stageTone(stageName).chip,
              )}
            >
              {stageName}
            </span>
          )
        )}
      </Link>
    </li>
  );
}

export function PhoneJobList() {
  const [folder, setFolder] = useState<string | null>(null);
  const jobsQuery = useSavedJobs({ collectionId: folder ?? undefined });
  const { data: stages = [] } = usePipelineStages();
  const { data: collections = [] } = useCollections();
  const [filters, setFilters] = useState<JobFilters>(NO_FILTERS);
  const [stage, setStage] = useState(() => readPref("jobsStage") ?? ALL);
  const [sheetOpen, setSheetOpen] = useState(false);

  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  const filtered = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);
  const counts = useMemo(() => stageCounts(filtered), [filtered]);
  // A remembered stage that has since been deleted falls back to All.
  const active = stages.some((s) => s.id === stage) ? stage : ALL;
  const shown = active === ALL ? filtered : filtered.filter((sj) => sj.pipeline_stage_id === active);
  const { limit, showMore, moreRef } = useShowMore(
    `${active}|${folder}|${JSON.stringify(filters)}`,
  );
  const stageNames = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);
  const jobTypes = useMemo(() => jobTypesIn(jobs), [jobs]);

  const set = (patch: Partial<JobFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const chooseStage = (id: string) => {
    setStage(id);
    writePref("jobsStage", id === ALL ? null : id);
  };
  const setCount = filtersSet(filters) + Number(folder !== null);
  const clearAll = () => {
    setFilters(NO_FILTERS);
    setFolder(null);
  };

  if (jobsQuery.isError && jobsQuery.data === undefined) {
    return (
      <ErrorState title="Couldn't load your jobs" onRetry={() => jobsQuery.refetch()}>
        The server didn&apos;t answer. Your jobs are safe.
      </ErrorState>
    );
  }

  return (
    <div>
      {/* Stays under the top bar while the rows scroll. */}
      <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 space-y-2 bg-background px-4 pb-2">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              enterKeyHint="search"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Search jobs or companies"
              aria-label="Search your jobs"
              className="h-11 pl-9 pr-10"
            />
            {filters.q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => set({ q: "" })}
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            className="relative h-11 shrink-0 gap-1.5 px-3"
            onClick={() => setSheetOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filters
            <CountBadge count={setCount} />
          </Button>
        </div>

        {/* The phone's board: one stage at a time, every stage's count in view. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          <Chip active={active === ALL} onClick={() => chooseStage(ALL)}>
            All <span className="tabular-nums opacity-80">{filtered.length}</span>
          </Chip>
          {stages
            .filter((s) => (counts.get(s.id) ?? 0) > 0 || s.id === active)
            .map((s) => (
              <Chip key={s.id} active={active === s.id} onClick={() => chooseStage(s.id)}>
                <span className={cn("h-2 w-2 rounded-full", stageTone(s.name).dot)} aria-hidden />
                {s.name} <span className="tabular-nums opacity-80">{counts.get(s.id) ?? 0}</span>
              </Chip>
            ))}
        </div>
      </div>

      {jobsQuery.isLoading ? (
        <ul className="divide-y" aria-busy aria-label="Loading your jobs">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex min-h-16 flex-col justify-center gap-2 py-2.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </li>
          ))}
        </ul>
      ) : jobs.length === 0 && setCount === 0 && !filters.q ? (
        <EmptyState
          icon={BookmarkX}
          title="No saved jobs yet"
          action={
            <Button asChild>
              <Link to="/search">Find jobs</Link>
            </Button>
          }
        >
          Save a job and it shows up here.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No jobs match"
          action={
            <Button
              variant="outline"
              onClick={() => {
                clearAll();
                chooseStage(ALL);
              }}
            >
              Clear search and filters
            </Button>
          }
        />
      ) : (
        <>
          <ul className="divide-y">
            {shown.slice(0, limit).map((sj) => (
              <JobRow
                key={sj.id}
                savedJob={sj}
                // The stage is in the chip above when one is chosen.
                stageName={
                  active === ALL ? (stageNames.get(sj.pipeline_stage_id ?? "") ?? null) : null
                }
              />
            ))}
          </ul>
          {shown.length > limit && (
            <button
              key={limit}
              ref={moreRef}
              type="button"
              onClick={showMore}
              className="mt-2 h-11 w-full rounded-md border border-dashed text-sm font-medium text-muted-foreground active:bg-accent"
            >
              Show more ({shown.length - limit} left)
            </button>
          )}
        </>
      )}

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription className="sr-only">Narrow down your saved jobs</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              Folder
              <select
                className={FIELD}
                value={folder ?? ""}
                onChange={(e) => setFolder(e.target.value || null)}
              >
                <option value="">All saved jobs</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Place
              <input
                className={FIELD}
                placeholder="City or state"
                value={filters.loc}
                onChange={(e) => set({ loc: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Pay
              <select
                className={FIELD}
                value={filters.minPay}
                onChange={(e) => set({ minPay: Number(e.target.value) })}
              >
                {PAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {jobTypes.length > 0 && (
              <label className="block space-y-1 text-sm font-medium">
                Type
                <select
                  className={FIELD}
                  value={filters.jobType}
                  onChange={(e) => set({ jobType: e.target.value })}
                >
                  <option value="all">Any type</option>
                  {jobTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block space-y-1 text-sm font-medium">
              Applied
              <select
                className={FIELD}
                value={filters.applied}
                onChange={(e) => set({ applied: e.target.value as AppliedFilter })}
              >
                <option value="all">All</option>
                <option value="not">Not applied</option>
                <option value="applied">Applied</option>
              </select>
            </label>
            <button
              type="button"
              aria-pressed={filters.remoteOnly}
              onClick={() => set({ remoteOnly: !filters.remoteOnly })}
              className={cn(
                "h-11 w-full rounded-md border text-base font-medium",
                filters.remoteOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground",
              )}
            >
              Remote only
            </button>
          </div>
          <DialogFooter className="flex-row">
            <Button variant="outline" onClick={clearAll} disabled={setCount === 0}>
              Clear
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Show {shown.length} {shown.length === 1 ? "job" : "jobs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
