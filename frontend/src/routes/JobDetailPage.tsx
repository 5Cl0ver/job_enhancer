import { useParams, useNavigate } from "react-router-dom";
import { useJob } from "@/hooks/useJobs";
import { useSavedJobId, useSaveJob, useUnsaveJob } from "@/hooks/useSavedJobs";
import { JobDetail } from "@/components/jobs/JobDetail";
import { JobEmails } from "@/components/email/JobEmails";
import { JobResumeType } from "@/components/scout/JobResumeType";
import { StagePicker } from "@/components/jobs/StagePicker";
import { Skeleton } from "@/components/ui/skeleton";

/** Full detail view for one job listing (reached by clicking a card title). */
export function JobDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading, isError } = useJob(id);
  const { savedJobId, savedJob } = useSavedJobId(id);
  const saveJob = useSaveJob();
  const unsaveJob = useUnsaveJob();

  const isSaved = !!savedJobId;
  const toggleSave = () => {
    if (isSaved && savedJobId) unsaveJob.mutate(savedJobId);
    else saveJob.mutate({ job_listing_id: id });
  };

  return (
    <div className="container mx-auto max-w-3xl md:px-4 md:py-6">
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
        <JobDetail
          job={job}
          isSaved={isSaved}
          onSave={toggleSave}
          onGenerateDocuments={() => navigate(`/ai-apply?job=${id}`)}
          aside={isSaved ? <JobResumeType jobListingId={id} /> : null}
          stage={savedJob ? <StagePicker savedJob={savedJob} /> : null}
        />
      )}
      {isSaved && <JobEmails jobListingId={id} />}
    </div>
  );
}
