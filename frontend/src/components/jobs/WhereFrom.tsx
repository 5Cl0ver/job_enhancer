/**
 * "Where this came from", on a saved job's page and pop-up: how it got into My
 * Jobs, which collection it is in, and the way back to its source: the Scout
 * search that found it (with Claude's reasons) or the email it was made from.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Folder } from "lucide-react";
import { EmailViewer } from "@/components/email/EmailViewer";
import { OriginLabel } from "@/components/jobs/OriginLabel";
import { Button } from "@/components/ui/button";
import { useJobSource } from "@/hooks/useSavedJobs";
import { folderLink, originOf, runLink } from "@/lib/origin";
import { sourceLabel } from "@/lib/scout";
import type { SavedJob } from "@/types/api";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WhereFrom({ savedJob }: { savedJob: SavedJob }) {
  const { data: source } = useJobSource(savedJob.id);
  const [emailOpen, setEmailOpen] = useState(false);
  const origin = originOf(savedJob);
  const scout = source?.scout ?? null;
  const email = source?.email ?? null;
  const folder = source?.collection ?? null;
  // Nothing to say about a job the app can't place that sits in no collection.
  if (!origin && !folder && !scout) return null;

  return (
    <section aria-label="Where this came from" className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <OriginLabel savedJob={savedJob} className="text-sm font-medium text-foreground" />
        <span className="text-muted-foreground">
          {!origin ? "Saved " : scout ? `on ${sourceLabel(scout.source)} · ` : "· "}
          {day(scout?.found_at ?? savedJob.created_at)}
        </span>
      </div>

      {scout && (scout.why_fit || scout.gaps) && (
        <div className="space-y-1 text-sm">
          {scout.why_fit && (
            <p>
              <span className="font-medium">Why it fits · </span>
              <span className="text-muted-foreground">{scout.why_fit}</span>
            </p>
          )}
          {scout.gaps && (
            <p>
              <span className="font-medium">Gaps · </span>
              <span className="text-muted-foreground">{scout.gaps}</span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {scout && (
          <Link
            to={runLink(scout.run_id)}
            className="inline-flex items-center font-medium text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            See the search that found it
          </Link>
        )}
        {email && (
          <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
            View the email
          </Button>
        )}
        {folder && (
          <Link
            to={folderLink(folder.id)}
            className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline pointer-coarse:min-h-11"
          >
            <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              In <span className="font-medium text-foreground">{folder.name}</span>
            </span>
          </Link>
        )}
      </div>

      {email && (
        <EmailViewer
          eventId={emailOpen ? email.event_id : null}
          mailLink={email.mail_link}
          searchLink={email.mail_search_link}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </section>
  );
}
