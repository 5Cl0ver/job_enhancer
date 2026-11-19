import { Building2, MapPin, DollarSign, Clock, Wifi, ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { ApplyButton } from "@/components/jobs/ApplyButton";
import { MatchScore } from "@/components/jobs/MatchScore";
import { JobDocuments } from "@/components/ai/JobDocuments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { plainText } from "@/lib/text";
import { cn, formatSalary } from "@/lib/utils";
import type { JobListing } from "@/types/api";

interface JobDetailProps {
  job: JobListing;
  onSave?: () => void;
  isSaved?: boolean;
  onGenerateDocuments?: () => void;
  /** Shown right under the actions, above the description (e.g. resume type). */
  aside?: React.ReactNode;
  /** The saved job's stage control, shown by the title and, on a phone, in the
   * action bar pinned to the bottom. */
  stage?: React.ReactNode;
}

/** Descriptions longer than this start folded on a phone. */
const LONG_DESCRIPTION = 700;

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_DESCRIPTION;
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Job Description</h2>
      <div
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground",
          // A phone shows the start and fades out; a computer shows it all.
          long &&
            !open &&
            "max-md:max-h-64 max-md:overflow-hidden max-md:[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
        )}
      >
        {text}
      </div>
      {long && (
        <Button
          variant="outline"
          className="w-full md:hidden"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Show less" : "Read the full description"}
        </Button>
      )}
    </div>
  );
}

export function JobDetail({
  job,
  onSave,
  isSaved = false,
  onGenerateDocuments,
  aside,
  stage,
}: JobDetailProps) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.currency, job.salary_period);
  const postedAgo = job.posted_at
    ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
    : null;
  const postedDate = job.posted_at
    ? format(new Date(job.posted_at), "MMM d, yyyy")
    : null;

  return (
    // Extra room at the bottom on a phone, for the pinned action bar.
    <div className="mx-auto max-w-3xl space-y-6 max-md:pb-16">
      {/* Back link (a phone has the back arrow in its top bar instead) */}
      <Link
        to="/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground max-md:hidden"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to My Jobs
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 break-words text-2xl font-bold leading-tight">
            {plainText(job.title)}
          </h1>
          <Badge variant="outline" className="shrink-0 capitalize">
            {job.source}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Building2 className="h-4 w-4" />
            {plainText(job.company)}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {job.location}
          </span>
          {job.is_remote && (
            <span className="flex items-center gap-1 text-green-600">
              <Wifi className="h-4 w-4" />
              Remote
            </span>
          )}
          {salary && (
            <span className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              {salary}
            </span>
          )}
          {postedAgo && (
            <span className="flex items-center gap-1" title={postedDate ?? undefined}>
              <Clock className="h-4 w-4" />
              {postedAgo}
            </span>
          )}
          {job.job_type && (
            <Badge variant="secondary" className="capitalize">
              {job.job_type.replace("_", "-").toLowerCase()}
            </Badge>
          )}
        </div>
      </div>

      {/* On a phone the stage sits in the pinned bar instead. */}
      {stage && <div className="flex items-center gap-2 max-md:hidden">{stage}</div>}

      {/* Actions. On a phone, Apply lives in the bar pinned to the bottom. */}
      <div className="flex flex-wrap gap-3">
        <ApplyButton job={job} className="max-md:hidden" />
        {/* Always a link to the original posting (for now this is the same as
            Apply; once we capture a separate company-apply URL, Apply Now goes
            to the employer and this stays pointed at the source listing). */}
        {job.apply_url && (
          <Button variant="ghost" asChild>
            <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
              View listing
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        )}
        {onSave &&
          (isSaved ? (
            <Button
              variant="outline"
              onClick={onSave}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
              Remove
            </Button>
          ) : (
            <Button variant="outline" onClick={onSave}>
              Save Job
            </Button>
          ))}
        {onGenerateDocuments && (
          <Button variant="outline" onClick={onGenerateDocuments}>
            Generate Documents
          </Button>
        )}
      </div>

      <Separator />

      {aside}

      {/* How well the resume covers this job's named skills */}
      <MatchScore jobId={job.id} />

      {/* Résumés and cover letters saved for this job — app-generated or written
          by Claude through the MCP connector. */}
      <JobDocuments jobListingId={job.id} />

      {/* Description */}
      {job.description ? (
        <Description text={job.description} />
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No description available. Visit the job posting for full details.
        </p>
      )}

      {/* Phone: the two things you came to do stay in reach, above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t bg-background px-4 py-2 md:hidden">
        {stage}
        <ApplyButton job={job} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
