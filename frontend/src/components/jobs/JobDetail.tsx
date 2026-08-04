import { Building2, MapPin, DollarSign, Clock, Wifi, ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { ApplyButton } from "@/components/jobs/ApplyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { JobListing } from "@/types/api";

interface JobDetailProps {
  job: JobListing;
  onSave?: () => void;
  isSaved?: boolean;
  onGenerateDocuments?: () => void;
}

function formatSalary(min?: number | null, max?: number | null, currency?: string | null) {
  const curr = currency ?? "USD";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
      maximumFractionDigits: 0,
    }).format(n);
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `Up to ${fmt(max)}`;
  return null;
}

export function JobDetail({ job, onSave, isSaved = false, onGenerateDocuments }: JobDetailProps) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.currency);
  const postedAgo = job.posted_at
    ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
    : null;
  const postedDate = job.posted_at
    ? format(new Date(job.posted_at), "MMM d, yyyy")
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <Link
        to="/saved"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to saved
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold leading-tight">{job.title}</h1>
          <Badge variant="outline" className="shrink-0 capitalize">
            {job.source}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Building2 className="h-4 w-4" />
            {job.company}
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

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <ApplyButton job={job} />
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

      {/* Description */}
      {job.description ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Job Description</h2>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {job.description}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No description available. Visit the job posting for full details.
        </p>
      )}
    </div>
  );
}
