import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BookmarkX, SlidersHorizontal, X } from "lucide-react";
import { EmailViewer } from "@/components/email/EmailViewer";
import { CollectionSidebar } from "@/components/jobs/CollectionSidebar";
import { JobCard } from "@/components/jobs/JobCard";
import { JobDetailDialog } from "@/components/tracker/JobDetailDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobEmailLatest } from "@/hooks/useEmailAccount";
import { ANY_ORIGIN, useJobsParams } from "@/hooks/useJobsParams";
import { useCollections, useSavedJobs, useUnsaveJob } from "@/hooks/useSavedJobs";
import { useShowMore } from "@/hooks/useShowMore";
import {
  NO_FILTERS,
  PAY_OPTIONS,
  filterJobs,
  filtersSet,
  jobTypesIn,
  type AppliedFilter,
  type JobFilters,
} from "@/lib/jobFilters";
import { ORIGIN_LABEL, originChoices } from "@/lib/origin";

const inputCls =
  "h-9 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/** The saved-jobs list on a computer (folders + filters + card grid): the
 *  "List" view of My Jobs. A phone gets PhoneJobList instead. */
export function SavedJobsBody() {
  // The collection and "where from" live in the address, so other pages can
  // link here ("In IT Admin", "2 saved to My Jobs › IT Admin").
  const { folder, origin, setFolder, setOrigin } = useJobsParams();
  const { data: collections } = useCollections();
  // A link to a collection that's gone shows everything, not an empty page.
  const selectedCollection =
    folder && (!collections || collections.some((c) => c.id === folder)) ? folder : null;
  const { data: savedJobs = [], isLoading, isError } = useSavedJobs({
    collectionId: selectedCollection ?? undefined,
  });
  const unsaveJob = useUnsaveJob();
  // Clicking a job opens the same pop-up the board does; its emails open from
  // the card. Ids, so both follow the list as it refreshes.
  const { data: emails } = useJobEmailLatest();
  // The pop-up belongs to the address it was opened at: following a link out
  // of it (to the job's collection) closes it.
  const { search } = useLocation();
  const [opened, setOpened] = useState<{ id: string; at: string } | null>(null);
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const openJob =
    opened && opened.at === search ? savedJobs.find((sj) => sj.id === opened.id) : undefined;
  const openEmail = emailFor ? emails?.get(emailFor) : undefined;

  const [typed, setTyped] = useState<JobFilters>(NO_FILTERS);
  const filters = useMemo(() => ({ ...typed, origin }), [typed, origin]);
  const set = (patch: Partial<JobFilters>) => setTyped((f) => ({ ...f, ...patch }));
  const { q, loc, minPay, jobType, applied, remoteOnly } = filters;
  const origins = useMemo(() => originChoices(savedJobs, origin), [savedJobs, origin]);

  // Job-type choices come from what's actually in the list.
  const jobTypes = useMemo(() => jobTypesIn(savedJobs), [savedJobs]);
  const filtered = useMemo(() => filterJobs(savedJobs, filters), [savedJobs, filters]);
  // Cards are drawn a page at a time; hundreds at once made the page crawl.
  const { limit, showMore, moreRef } = useShowMore(
    `${selectedCollection}|${JSON.stringify(filters)}`,
  );

  const activeFilters = !!q || filtersSet(filters) > 0;
  const clearFilters = () => {
    setTyped(NO_FILTERS);
    setOrigin(ANY_ORIGIN);
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <CollectionSidebar selectedId={selectedCollection} onSelect={setFolder} />

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
            onChange={(e) => set({ q: e.target.value })}
          />
          <input
            className={`${inputCls} w-32`}
            placeholder="Location / state"
            value={loc}
            onChange={(e) => set({ loc: e.target.value })}
          />
          <select className={inputCls} value={minPay} onChange={(e) => set({ minPay: Number(e.target.value) })}>
            {PAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {jobTypes.length > 0 && (
            <select className={inputCls} value={jobType} onChange={(e) => set({ jobType: e.target.value })}>
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
            onChange={(e) => set({ applied: e.target.value as AppliedFilter })}
          >
            <option value="all">All</option>
            <option value="not">Not applied</option>
            <option value="applied">Applied</option>
          </select>
          {origins.length > 0 && (
            <select
              className={inputCls}
              aria-label="Where from"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              <option value={ANY_ORIGIN}>From anywhere</option>
              {origins.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABEL[o]}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => set({ remoteOnly: !remoteOnly })}
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
              {filtered.slice(0, limit).map((sj) => (
                <JobCard
                  key={sj.id}
                  job={sj.job_listing}
                  isSaved
                  applied={!!sj.applied_at}
                  savedJobId={sj.id}
                  savedJob={sj}
                  onOpen={() => setOpened({ id: sj.id, at: search })}
                  email={emails?.get(sj.id)}
                  onOpenEmail={() => setEmailFor(sj.id)}
                  onSave={() => unsaveJob.mutate(sj.id)}
                />
              ))}
            </div>
            {filtered.length > limit && (
              <button
                key={limit}
                ref={moreRef}
                type="button"
                onClick={showMore}
                className="mt-4 h-10 w-full rounded-md border border-dashed text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Show more ({filtered.length - limit} left)
              </button>
            )}
          </>
        )}
      </main>

      {openJob && (
        <JobDetailDialog
          savedJob={openJob}
          open
          onOpenChange={(open) => !open && setOpened(null)}
        />
      )}
      <EmailViewer
        eventId={openEmail?.event_id ?? null}
        mailLink={openEmail?.mail_link}
        searchLink={openEmail?.mail_search_link}
        onClose={() => setEmailFor(null)}
      />
    </div>
  );
}
