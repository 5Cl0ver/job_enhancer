/**
 * The jobs one Scout run reported, best fit first. Saved ones link to the job
 * in the app; ones whose page copy never arrived link to the posting so the
 * user can open it and press Save. Claude's reasons are labelled as Claude's.
 */
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OUTCOME_LABEL, fitBand, type Finding } from "@/lib/scout";

const OUTCOME_STYLE: Record<Finding["outcome"], string> = {
  saved: "bg-emerald-600 text-white hover:bg-emerald-600",
  below_bar: "",
  duplicate: "",
  waiting_for_copy: "",
  no_copy: "bg-amber-500 text-white hover:bg-amber-500",
};

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
  const title =
    f.title ||
    (f.outcome === "no_copy" ? "This job's page wasn't copied" : "Copying the job page…");
  return (
    <li className="space-y-1.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={f.outcome === "saved" || f.outcome === "no_copy" ? "default" : "secondary"}
          className={OUTCOME_STYLE[f.outcome]}
        >
          {OUTCOME_LABEL[f.outcome]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Fit {f.fit_score}/10 · {fitBand(f.fit_score)}
        </span>
      </div>
      <div className="min-w-0">
        {f.outcome === "saved" && f.job_listing_id ? (
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
      {f.outcome !== "saved" && (
        <a
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          {f.outcome === "no_copy" ? "Open and press Save" : "Open posting"}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </li>
  );
}
