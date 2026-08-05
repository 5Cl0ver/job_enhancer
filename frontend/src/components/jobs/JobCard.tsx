import { Link } from "react-router-dom";
import { Building2, MapPin, DollarSign, Clock, Wifi, Trash2 } from "lucide-react";
import { ApplyButton } from "@/components/jobs/ApplyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { formatSalary } from "@/lib/utils";
import type { JobListing } from "@/types/api";

interface JobCardProps {
  job: JobListing;
  onSave?: (jobId: string) => void;
  isSaved?: boolean;
}

export function JobCard({ job, onSave, isSaved = false }: JobCardProps) {
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
        <div className="ml-auto flex gap-2">
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
