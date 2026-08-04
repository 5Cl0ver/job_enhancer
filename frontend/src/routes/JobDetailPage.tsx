import { useParams } from "react-router-dom";
import { useJob } from "@/hooks/useJobs";
import { useSavedJobId, useSaveJob, useUnsaveJob } from "@/hooks/useSavedJobs";
import { JobDetail } from "@/components/jobs/JobDetail";
import { Skeleton } from "@/components/ui/skeleton";

/** Full detail view for one job listing (reached by clicking a card title). */
export function JobDetailPage() {
  const { id = "" } = useParams();
  const { data: job, isLoading, isError } = useJob(id);
  const { savedJobId } = useSavedJobId(id);
  const saveJob = useSaveJob();
  const unsaveJob = useUnsaveJob();

  const isSaved = !!savedJobId;
  const toggleSave = () => {
    if (isSaved && savedJobId) unsaveJob.mutate(savedJobId);
    else saveJob.mutate({ job_listing_id: id });
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError || !job ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
          Couldn't load this job. It may have been removed.
        </div>
      ) : (
        <JobDetail job={job} isSaved={isSaved} onSave={toggleSave} />
      )}
    </div>
  );
}
