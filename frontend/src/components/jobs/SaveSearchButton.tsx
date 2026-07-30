import { useSearchParams } from "react-router-dom";
import { BellPlus, Check, Loader2 } from "lucide-react";
import { useCreateSavedSearch, useSavedSearches } from "@/hooks/useSavedSearches";
import { Button } from "@/components/ui/button";

/**
 * Saves the current search criteria (FR-024). The app re-runs saved
 * searches daily and surfaces new results in the New Matches feed.
 */
export function SaveSearchButton() {
  const [searchParams] = useSearchParams();
  const create = useCreateSavedSearch();
  const { data: existing = [] } = useSavedSearches();

  const q = searchParams.get("q") ?? "";
  const location = searchParams.get("location") ?? undefined;
  const remoteOnly = searchParams.get("remote_only") === "true";
  const salaryMin = searchParams.get("salary_min");
  const salaryMax = searchParams.get("salary_max");
  const experience = searchParams.get("experience") ?? undefined;
  const jobType = searchParams.get("job_type") ?? undefined;

  if (!q) return null;

  const alreadySaved = existing.some(
    (s) =>
      s.q === q &&
      (s.location ?? undefined) === location &&
      s.remote_only === remoteOnly &&
      (s.experience ?? undefined) === experience &&
      (s.job_type ?? undefined) === jobType,
  );

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={alreadySaved || create.isPending}
      onClick={() =>
        create.mutate({
          q,
          location,
          remote_only: remoteOnly,
          salary_min: salaryMin ? Number(salaryMin) : undefined,
          salary_max: salaryMax ? Number(salaryMax) : undefined,
          experience,
          job_type: jobType,
        })
      }
      className="gap-1.5"
    >
      {create.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : alreadySaved ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <BellPlus className="h-3.5 w-3.5" aria-hidden />
      )}
      {alreadySaved ? "Search saved" : "Save this search"}
    </Button>
  );
}
