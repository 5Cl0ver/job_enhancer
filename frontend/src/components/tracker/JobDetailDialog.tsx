import { useState } from "react";
import { Building2, MapPin } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JobEmails } from "@/components/email/JobEmails";
import { JobActions } from "@/components/jobs/JobActions";
import { NameCheck, RenameButton } from "@/components/jobs/RenameJob";
import { StagePicker } from "@/components/jobs/StagePicker";
import { WhereFrom } from "@/components/jobs/WhereFrom";
import { usePipelineStages } from "@/hooks/useTracker";
import { useJob } from "@/hooks/useJobs";
import { JobDocuments } from "@/components/ai/JobDocuments";
import { cn } from "@/lib/utils";
import type { JobListing, SavedJob } from "@/types/api";

/** Descriptions longer than this start folded. */
const LONG_DESCRIPTION = 500;

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

export function salaryText(j: JobListing): string | null {
  if (!j.salary_min && !j.salary_max) return null;
  const per = j.salary_period === "hourly" ? "/hr" : "/yr";
  if (j.salary_min && j.salary_max)
    return `${money(j.salary_min)}–${money(j.salary_max)} ${per}`;
  return `${money(j.salary_min ?? j.salary_max!)} ${per}`;
}

export function JobDetailDialog({
  savedJob,
  open,
  onOpenChange,
}: {
  savedJob: SavedJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The board's list data has no full description (bandwidth); load the full
  // listing only while this dialog is open. Cached per job by `useJob`.
  const { data: fullListing, isLoading: loadingDescription } = useJob(
    open ? savedJob.job_listing_id : null,
  );
  const j: JobListing = fullListing ?? savedJob.job_listing;
  const pay = salaryText(j);
  const [showAll, setShowAll] = useState(false);
  const { data: stages = [] } = usePipelineStages();

  const stage = stages.find((st) => st.id === savedJob.pipeline_stage_id);
  const facts = [
    savedJob.applied_at &&
      `Applied ${format(new Date(savedJob.applied_at), "MMM d")}`,
    stage &&
      `In ${stage.name} since ${format(new Date(savedJob.last_stage_change), "MMM d")}`,
    `Saved ${format(new Date(savedJob.created_at), "MMM d")}`,
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88vh] gap-5 overflow-y-auto sm:max-w-xl"
        // Following a link to another part of the app (the job's collection,
        // its Scout search, the full page) closes the pop-up, so it never sits
        // on top of the page the link went to.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('a[href^="/"]')) onOpenChange(false);
        }}
      >
        {/* What the job is, and where it stands. */}
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="break-words pr-8 text-xl leading-snug">
            {j.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4" aria-hidden /> {j.company}
              </span>
              {j.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden /> {j.location}
                </span>
              )}
              {j.is_remote && <Badge variant="secondary">Remote</Badge>}
              {pay && (
                <span className="font-medium text-foreground">{pay}</span>
              )}
            </div>
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <StagePicker savedJob={savedJob} />
            <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>
            <span className="ml-auto">
              <RenameButton savedJob={savedJob} />
            </span>
          </div>
        </DialogHeader>

        <NameCheck savedJob={savedJob} />

        {/* How it got here, then why it's in that stage: the emails behind it. */}
        {open && <WhereFrom savedJob={savedJob} />}
        <JobEmails jobListingId={savedJob.job_listing_id} sayWhenNone />

        {/* What you can do with it (the same on the job's full page). */}
        <JobActions
          savedJob={savedJob}
          listing={j}
          descriptionReady={!!fullListing || !loadingDescription}
        />

        <JobDocuments jobListingId={savedJob.job_listing_id} compact />

        {savedJob.notes && (
          <section className="space-y-2">
            <SectionTitle>Your notes</SectionTitle>
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
              {savedJob.notes}
            </p>
          </section>
        )}

        <section className="space-y-2">
          <SectionTitle>Description</SectionTitle>
          {!fullListing && loadingDescription ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : j.description ? (
            <>
              <p
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90",
                  !showAll &&
                    j.description.length > LONG_DESCRIPTION &&
                    "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
                )}
              >
                {j.description}
              </p>
              {j.description.length > LONG_DESCRIPTION && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? "Show less" : "Read the full description"}
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No description saved for this job.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}
