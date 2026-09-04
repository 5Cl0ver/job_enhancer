import { Link } from "react-router-dom";
import { Building2, MapPin, DollarSign, Clock, Wifi, Trash2, Check, Undo2 } from "lucide-react";
import { ApplyButton } from "@/components/jobs/ApplyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { formatSalary } from "@/lib/utils";
import { useToggleApplied } from "@/hooks/useSavedJobs";
import { usePipelineStages } from "@/hooks/useTracker";
import type { JobListing } from "@/types/api";

interface JobCardProps {
  job: JobListing;
  onSave?: (jobId: string) => void;
  isSaved?: boolean;
  /** Show an "Applied" badge (the saved job has an applied_at). */
  applied?: boolean;
  /** The saved-job row id — enables the "Applied / Undo" toggle. */
  savedJobId?: string;
}

export function JobCard({
  job,
  onSave,
  isSaved = false,
  applied = false,
  savedJobId,
}: JobCardProps) {
  const toggleApplied = useToggleApplied();
  const { data: stages } = usePipelineStages();
  const appliedStage = stages?.find((s) => s.name === "Applied");
  // Stages arrive sorted by sort_order, so [0] is the pipeline's entry point.
  const firstStage = stages?.[0];
  const salary = formatSalary(job.salary_min, job.salary_max, job.currency, job.salary_period);
  const postedAgo = job.posted_at
    ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
    : null;

  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to={`/jobs/${job.id}`}
              className="line-clamp-2 font-semibold leading-tight hover:underline"
            >
              {job.title}
            </Link>
            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{job.company}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {applied && (
              <Badge className="bg-green-600 text-xs hover:bg-green-600">✓ Applied</Badge>
            )}
            <Badge variant="outline" className="text-xs capitalize">
              {job.source}
            </Badge>
            {job.is_expired && (
              <Badge variant="destructive" className="text-xs">
                Listing expired
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-2">
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{job.location}</span>
            {job.is_remote && (
              <span className="flex items-center gap-0.5 text-green-600">
                <Wifi className="h-3 w-3" />
                Remote
              </span>
            )}
          </div>

          {salary && (
            <div className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5 shrink-0" />
              <span>{salary}</span>
            </div>
          )}

          {job.job_type && (
            <Badge variant="secondary" className="text-xs">
              {job.job_type.replace("_", "-").toLowerCase()}
            </Badge>
          )}
        </div>

        {job.description && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
            {job.description}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 pt-2">
        {postedAgo && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {postedAgo}
          </span>
        )}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {/* Applied toggle — mark it yourself, or undo a mis-tap. Also moves
              the pipeline stage so the board agrees with the list. Undo returns
              the job to the FIRST stage (never null: the board groups strictly
              by stage id, so a stageless job would vanish from every column). */}
          {savedJobId && (
            <Button
              variant={applied ? "ghost" : "outline"}
              size="sm"
              disabled={toggleApplied.isPending}
              title={applied ? "Undo — I haven't applied" : "I've applied to this"}
              onClick={() =>
                toggleApplied.mutate({
                  id: savedJobId,
                  applied: !applied,
                  stageId: applied
                    ? (firstStage?.id ?? undefined)
                    : (appliedStage?.id ?? undefined),
                })
              }
              className={
                applied
                  ? "h-7 text-xs text-muted-foreground"
                  : "h-7 text-xs text-green-700 dark:text-green-400"
              }
            >
              {applied ? (
                <>
                  <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Undo
                </>
              ) : (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Applied
                </>
              )}
            </Button>
          )}
          {onSave && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSave(job.id)}
              className={
                isSaved
                  ? "h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  : "h-7 text-xs"
              }
            >
              {isSaved ? (
                <>
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Remove
                </>
              ) : (
                "Save"
              )}
            </Button>
          )}
          <ApplyButton
            job={job}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
          />
        </div>
      </CardFooter>
    </Card>
  );
}
