import { useParams, useNavigate } from "react-router-dom";
import { useJob } from "@/hooks/useJobs";
import { useSavedJobId, useSaveJob, useUnsaveJob } from "@/hooks/useSavedJobs";
import { JobDetail } from "@/components/jobs/JobDetail";
import { JobEmails } from "@/components/email/JobEmails";
import { JobActions } from "@/components/jobs/JobActions";
import { NameCheck, RenameButton } from "@/components/jobs/RenameJob";
import { WhereFrom } from "@/components/jobs/WhereFrom";
import { JobResumeType } from "@/components/scout/JobResumeType";
import { StagePicker } from "@/components/jobs/StagePicker";
import { Skeleton } from "@/components/ui/skeleton";
import { usePipelineStages } from "@/hooks/useTracker";
import type { SavedJob } from "@/types/api";

/** "In Phone Screen since Aug 20": the stage in words, with when it got there. */
function StageSince({ savedJob }: { savedJob: SavedJob }) {
  const { data: stages = [] } = usePipelineStages();
  const stage = stages.find((s) => s.id === savedJob.pipeline_stage_id);
  if (!stage) return null;
  return (
    <p className="text-sm text-muted-foreground">
      In <span className="font-medium text-foreground">{stage.name}</span> since{" "}
      {new Date(savedJob.last_stage_change).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </p>
  );
}

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
    // max-md:pb-16: room for the phone's pinned Stage / Apply bar, below the
    // last thing on the page (the job's emails).
    <div className="container mx-auto max-w-3xl max-md:pb-16 md:px-4 md:py-6">
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
          aside={
            isSaved ? (
              <>
                {/* First: where this job stands, and the emails that explain it. */}
                {savedJob && <NameCheck savedJob={savedJob} />}
                {savedJob && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StageSince savedJob={savedJob} />
                    <RenameButton savedJob={savedJob} />
                  </div>
                )}
                {savedJob && <WhereFrom savedJob={savedJob} />}
                <JobEmails jobListingId={id} sayWhenNone />
                {/* The same actions the board's pop-up has. */}
                {savedJob && <JobActions page savedJob={savedJob} listing={job} />}
                <JobResumeType jobListingId={id} />
              </>
            ) : null
          }
          stage={savedJob ? <StagePicker savedJob={savedJob} /> : null}
          savedJob={savedJob}
        />
      )}
    </div>
  );
}
