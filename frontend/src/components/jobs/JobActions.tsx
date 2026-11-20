/**
 * What you can do with a saved job, the same wherever the job is opened: the
 * board's pop-up, the list's pop-up and the job's full page. Write to the
 * company, research it with Claude, put it on Contact Further.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Mail, MailCheck, Maximize2, Search, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useToggleEmailed, useToggleResearchFlag } from "@/hooks/useTracker";
import { buildResearchPrompt } from "@/lib/researchPrompt";
import type { JobListing, SavedJob } from "@/types/api";

export function JobActions({
  savedJob,
  listing,
  page = false,
  descriptionReady = true,
}: {
  savedJob: SavedJob;
  /** The listing with its full description when it has loaded. */
  listing: JobListing;
  /** On the job's own page, which already has Apply and is the full page. */
  page?: boolean;
  /** False while the full description is still loading (the research prompt
   * quotes it). */
  descriptionReady?: boolean;
}) {
  const toggleFlag = useToggleResearchFlag();
  const toggleEmailed = useToggleEmailed();
  const { data: profile } = useProfile();
  const [copied, setCopied] = useState(false);
  const fromEmail = savedJob.origin === "email";

  // Open the user's mail client pre-filled with a subject, and auto-mark the
  // job "Emailed" — that's the seamless loop (research gives the address + draft,
  // this opens compose so they paste + send, tracking fills itself in).
  const composeEmail = () => {
    const subject = `Application for ${listing.title} at ${listing.company}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
    if (!savedJob.emailed_at) {
      toggleEmailed.mutate({ savedJobId: savedJob.id, emailedAt: new Date().toISOString() });
    }
  };

  const researchWithClaude = async () => {
    try {
      await navigator.clipboard.writeText(buildResearchPrompt(listing));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — the Claude tab still opens */
    }
    // Open the user's linked Claude Project (shared with the extension) if set,
    // otherwise a fresh Claude chat. Set it in Settings → Claude Project.
    const url = profile?.claude_project_url?.trim();
    window.open(
      url && /^https?:\/\//i.test(url) ? url : "https://claude.ai/new",
      "_blank",
      "noopener",
    );
  };

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Actions
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {!page && listing.apply_url && (
          <Button asChild className="gap-1.5 sm:col-span-2">
            <a href={listing.apply_url} target="_blank" rel="noopener noreferrer">
              {fromEmail ? "Open the email" : "Open job posting"}{" "}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        )}
        {savedJob.emailed_at ? (
          <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm">
            <span className="flex items-center gap-1.5">
              <MailCheck className="h-4 w-4 text-emerald-600" aria-hidden />
              Emailed {format(new Date(savedJob.emailed_at), "MMM d")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleEmailed.mutate({ savedJobId: savedJob.id, emailedAt: null })}
            >
              Undo
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="justify-start gap-2" onClick={composeEmail}>
            <Mail className="h-4 w-4" aria-hidden /> Write to the company
          </Button>
        )}
        <Button
          variant="outline"
          className="justify-start gap-2"
          onClick={researchWithClaude}
          disabled={!descriptionReady}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Copied. Paste it in Claude" : "Research it with Claude"}
        </Button>
        <Button
          variant="outline"
          className="justify-start gap-2"
          aria-pressed={savedJob.flagged_for_research}
          onClick={() =>
            toggleFlag.mutate({
              savedJobId: savedJob.id,
              flagged: !savedJob.flagged_for_research,
            })
          }
        >
          <Search className="h-4 w-4" aria-hidden />
          {savedJob.flagged_for_research ? "Remove from Contact Further" : "Add to Contact Further"}
        </Button>
        {!page && (
          <Button asChild variant="outline" className="justify-start gap-2">
            <Link to={`/jobs/${savedJob.job_listing_id}`}>
              <Maximize2 className="h-4 w-4" aria-hidden /> Open the full page
            </Link>
          </Button>
        )}
        {!savedJob.emailed_at && (
          <button
            type="button"
            onClick={() =>
              toggleEmailed.mutate({ savedJobId: savedJob.id, emailedAt: new Date().toISOString() })
            }
            className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pointer-coarse:min-h-11 sm:col-span-2"
          >
            I already emailed them
          </button>
        )}
      </div>
    </section>
  );
}
