/**
 * "Resume type" on a saved job's page: which of the user's resume types (and so
 * which resume) to apply with. Claude Scout sets it; the user can change it.
 */
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { useSavedJobs, useUpdateSavedJob } from "@/hooks/useSavedJobs";
import { useTracks } from "@/hooks/useScout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export function JobResumeType({ jobListingId }: { jobListingId: string }) {
  const { data: saved } = useSavedJobs();
  const { data: tracks } = useTracks();
  const update = useUpdateSavedJob();
  const job = saved?.find((sj) => sj.job_listing_id === jobListingId);
  if (!job || !tracks) return null;

  if (tracks.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        <Link to="/search?tab=scout" className="text-primary underline underline-offset-2">
          Set up resume types
        </Link>{" "}
        to tag jobs with the resume you'll apply with.
      </p>
    );

  const track = tracks.find((t) => t.id === job.track_id);
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">Resume type</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {track
              ? track.resume_filename
                ? `Apply with ${track.resume_filename}`
                : `No resume attached to ${track.name} yet`
              : "Pick the kind of role this is."}
          </span>
        </p>
        {update.isError && (
          <p className="text-xs text-destructive">Couldn't save that. Try again.</p>
        )}
      </div>
      <Select
        value={job.track_id ?? NONE}
        disabled={update.isPending}
        onValueChange={(v) => update.mutate({ id: job.id, track_id: v === NONE ? null : v })}
      >
        <SelectTrigger className="w-full sm:w-56" aria-label="Resume type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not set</SelectItem>
          {tracks.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
