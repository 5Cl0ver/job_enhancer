import { Suspense } from "react";
import { SaveSearchButton } from "@/components/jobs/SaveSearchButton";
import { SearchBar } from "@/components/jobs/SearchBar";
import { SearchFilters } from "@/components/jobs/SearchFilters";
import { SearchResults } from "@/components/jobs/SearchResults";
import { Skeleton } from "@/components/ui/skeleton";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    location?: string;
    remote_only?: string;
    salary_min?: string;
    salary_max?: string;
    experience?: string;
    job_type?: string;
    page?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Search Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Search across multiple job boards, deduplicated for you.
        </p>
      </div>

      <SearchBar defaultQuery={params.q ?? ""} defaultLocation={params.location ?? ""} />

      {params.q && (
        <Suspense fallback={null}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchFilters />
            <SaveSearchButton />
          </div>
        </Suspense>
      )}

      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-lg" />
            ))}
          </div>
        }
      >
        <SearchResults searchParams={params} />
      </Suspense>
    </div>
  );
}
