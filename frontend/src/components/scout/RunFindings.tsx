/**
 * The jobs one Scout run reported, best fit first. Saved ones link to the job
 * and its collection; ones the user passed on (or Claude scored under the bar)
 * can still be saved from here; ones whose page copy never arrived link to the
 * posting so the user can open it and press Save. Claude's reasons are
 * labelled as Claude's.
 */
import { Link } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/scout/errorText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSaveFinding } from "@/hooks/useScout";
import { folderLink } from "@/lib/origin";
import { OUTCOME_LABEL, fitBand, type Finding } from "@/lib/scout";

const OUTCOME_STYLE: Record<Finding["outcome"], string> = {
  picked: "bg-primary text-primary-foreground hover:bg-primary",
  saved: "bg-emerald-600 text-white hover:bg-emerald-600",
  skipped: "",
  below_bar: "",
  duplicate: "",
  waiting_for_copy: "",
  no_copy: "bg-amber-500 text-white hover:bg-amber-500",
  too_far: "",
};
const SOLID: Finding["outcome"][] = ["picked", "saved", "no_copy"];

export function RunFindings({ findings }: { findings: Finding[] }) {
  return (
    <ul className="divide-y rounded-md border bg-background">
      {findings.map((f) => (
        <FindingRow key={f.id} finding={f} />
      ))}
    </ul>
  );
}

function FindingRow({ finding: f }: { finding: Finding }) {
  const save = useSaveFinding();
  const title =
    f.title ||
    (f.outcome === "no_copy" ? "This job's page wasn't copied" : "Copying the job page…");
  const inMyJobs = (f.outcome === "saved" || f.outcome === "duplicate") && f.job_listing_id;
  // Passed on, or under the bar: still one press away while its copy exists.
  const canSaveNow = f.can_save && (f.outcome === "skipped" || f.outcome === "below_bar");
  return (
    <li className="space-y-1.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={SOLID.includes(f.outcome) ? "default" : "secondary"}
          className={OUTCOME_STYLE[f.outcome]}
        >
          {OUTCOME_LABEL[f.outcome]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Fit {f.fit_score}/10 · {fitBand(f.fit_score)}
        </span>
      </div>
      <div className="min-w-0">
        {inMyJobs ? (
          <Link
            to={`/jobs/${f.job_listing_id}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {title}
          </Link>
        ) : (
          <p className="font-medium">{title}</p>
        )}
        {f.company && <p className="text-sm text-muted-foreground">{f.company}</p>}
      </div>
      {f.app_note && <p className="text-xs text-muted-foreground">{f.app_note}</p>}
      {f.closest_track_name && (
        <p className="text-xs text-muted-foreground">
          Closest resume type: {f.closest_track_name}
        </p>
      )}
      {(f.why_fit || f.gaps) && (
        <div className="space-y-0.5 text-xs">
          {f.why_fit && (
            <p>
              <span className="font-medium">Claude: why it fits · </span>
              {f.why_fit}
            </p>
          )}
          {f.gaps && (
            <p>
              <span className="font-medium">Claude: gaps · </span>
              {f.gaps}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {canSaveNow && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { findingId: f.id },
                {
                  onSuccess: (r) =>
                    toast.success(
                      r.already
                        ? "That job was already in My Jobs."
                        : `Saved to My Jobs › ${r.folder.name}`,
                    ),
                  onError: (e) => toast.error(errorText(e, "Couldn't save that job.")),
                },
              )
            }
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Save to My Jobs
          </Button>
        )}
        {f.outcome === "saved" && f.collection_id && (
          <Link
            to={folderLink(f.collection_id)}
            className="inline-flex items-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline pointer-coarse:min-h-11"
          >
            In <span className="ml-1 font-medium text-foreground">{f.collection_name}</span>
          </Link>
        )}
        {f.outcome !== "saved" && (
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            {f.outcome === "no_copy" ? "Open and press Save" : "Open posting"}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}
