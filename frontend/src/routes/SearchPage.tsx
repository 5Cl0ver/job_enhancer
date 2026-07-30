import { useSearchParams } from "react-router-dom";
import { SaveSearchButton } from "@/components/jobs/SaveSearchButton";
import { SearchBar } from "@/components/jobs/SearchBar";
import { SearchFilters } from "@/components/jobs/SearchFilters";
import { SearchResults } from "@/components/jobs/SearchResults";

// Ported from the Next.js server component `app/(dashboard)/search/page.tsx`.
// In Next, the query string arrived as a `searchParams` prop (resolved on the
// server). In a React Router SPA we read it from the URL with the
// useSearchParams() hook instead — everything runs in the browser.
export function SearchPage() {
  const [searchParams] = useSearchParams();

  const params = {
    q: searchParams.get("q") ?? undefined,
    location: searchParams.get("location") ?? undefined,
    remote_only: searchParams.get("remote_only") ?? undefined,
    salary_min: searchParams.get("salary_min") ?? undefined,
    salary_max: searchParams.get("salary_max") ?? undefined,
    experience: searchParams.get("experience") ?? undefined,
    job_type: searchParams.get("job_type") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Search Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Search across multiple job boards, deduplicated for you.
        </p>
      </div>

      <SearchBar
        defaultQuery={params.q ?? ""}
        defaultLocation={params.location ?? ""}
      />

      {params.q && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchFilters />
          <SaveSearchButton />
        </div>
      )}

      <SearchResults searchParams={params} />
    </div>
  );
}
