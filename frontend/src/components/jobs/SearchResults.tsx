import { useEffect } from "react";
import { useJobSearch, useRefreshSearch } from "@/hooks/useJobs";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { JobCard } from "@/components/jobs/JobCard";
import { Button } from "@/components/ui/button";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, SearchX } from "lucide-react";

interface SearchResultsProps {
  searchParams: {
    q?: string;
    location?: string;
    remote_only?: string;
    salary_min?: string;
    salary_max?: string;
    experience?: string;
    job_type?: string;
    page?: string;
  };
}

export function SearchResults({ searchParams }: SearchResultsProps) {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const query = searchParams.q ?? "";
  const page = Number(searchParams.page ?? 1);

  const params = {
    q: query,
    location: searchParams.location,
    remote_only: searchParams.remote_only === "true",
    salary_min: searchParams.salary_min ? Number(searchParams.salary_min) : undefined,
    salary_max: searchParams.salary_max ? Number(searchParams.salary_max) : undefined,
    experience: searchParams.experience,
    job_type: searchParams.job_type,
    page,
    page_size: 20,
  };
  const { data, isLoading, isError, isFetching } = useJobSearch(params, !!query);
  const refresh = useRefreshSearch();
  // A "used up" note belongs to the search it came from, not the next one.
  const searchKey = JSON.stringify(params);
  const { reset } = refresh;
  useEffect(() => reset(), [searchKey, reset]);

  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <SearchX className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-lg font-medium">Search for your next role</p>
        <p className="text-sm text-muted-foreground">
          Enter a job title, skill, or company above to get started.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
        Failed to load results. Please try again.
      </div>
    );
  }

  // Today's live searches are used up: these are jobs already in the app.
  const note = refresh.data?.live === false ? refresh.data.note : data.live === false ? data.note : null;
  const noteBox = note && (
    <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      {note}
    </p>
  );

  if (data.results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        {noteBox}
        <SearchX className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-lg font-medium">No results found</p>
        <p className="text-sm text-muted-foreground">
          Try adjusting your query or removing filters, or search the job sites live.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => refresh.mutate(params)}
            disabled={refresh.isPending}
          >
            {refresh.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {refresh.isPending ? "Searching…" : "Search live"}
          </Button>
          <AllowanceNote kind="live_search" />
        </div>
      </div>
    );
  }

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(urlParams.toString());
    params.set("page", String(newPage));
    navigate(`/search?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {noteBox}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {data.meta.total} result{data.meta.total !== 1 ? "s" : ""} for &quot;{query}&quot;
          {isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <AllowanceNote kind="live_search" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => refresh.mutate(params)}
            disabled={refresh.isPending}
            title="Fetch the latest jobs live from all sources"
          >
            {refresh.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {refresh.isPending ? "Refreshing…" : "Refresh live"}
          </Button>
          <span>
            Page {data.meta.page} of {data.meta.total_pages}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.results.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>

      {data.meta.total_pages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.meta.total_pages}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
