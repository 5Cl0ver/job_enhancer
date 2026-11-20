import { useSearchParams } from "react-router-dom";
import { Bot, Search } from "lucide-react";
import { SaveSearchButton } from "@/components/jobs/SaveSearchButton";
import { SearchBar } from "@/components/jobs/SearchBar";
import { SearchFilters } from "@/components/jobs/SearchFilters";
import { SearchResults } from "@/components/jobs/SearchResults";
import { ScoutPanel } from "@/components/scout/ScoutPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SCOUT = "scout";

// Ported from the Next.js server component `app/(dashboard)/search/page.tsx`.
// In Next, the query string arrived as a `searchParams` prop (resolved on the
// server). In a React Router SPA we read it from the URL with the
// useSearchParams() hook instead — everything runs in the browser.
//
// "Find Jobs" has two tabs: Job boards (the API search below) and Claude Scout
// (?tab=scout), where Claude in Chrome does the searching. The tab lives in the
// URL so links and the back button land on the right one.
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === SCOUT ? SCOUT : "boards";
  const setTab = (next: string) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === SCOUT) p.set("tab", SCOUT);
        else p.delete("tab");
        return p;
      },
      { replace: true },
    );

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
    <div className="container mx-auto max-w-6xl space-y-6 md:px-4 md:py-6">
      <h1 className="text-2xl font-bold tracking-tight max-md:hidden">Find Jobs</h1>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="boards" className="flex-1 gap-1.5 sm:flex-none">
            <Search className="h-4 w-4" aria-hidden /> Job boards
          </TabsTrigger>
          <TabsTrigger value={SCOUT} className="flex-1 gap-1.5 sm:flex-none">
            <Bot className="h-4 w-4" aria-hidden /> Claude Scout
          </TabsTrigger>
        </TabsList>

        <TabsContent value="boards" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Search across multiple job boards, deduplicated for you.
          </p>

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
        </TabsContent>

        <TabsContent value={SCOUT}>
          <ScoutPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
