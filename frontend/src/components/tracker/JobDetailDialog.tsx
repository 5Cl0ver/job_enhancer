import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Check,
  ExternalLink,
  Mail,
  MailCheck,
  MapPin,
  Maximize2,
  Search,
  Sparkles,
} from "lucide-react";
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
import { StagePicker } from "@/components/jobs/StagePicker";
import {
  usePipelineStages,
  useToggleResearchFlag,
  useToggleEmailed,
} from "@/hooks/useTracker";
import { useProfile } from "@/hooks/useProfile";
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

/**
 * A paste-ready prompt for the user's own Claude Project (which already has
 * their résumé in its knowledge). It leads with a READY-TO-SEND outreach email
 * grounded in the résumé + the full job description, then who-to-email, where
 * else to apply, and contacts — tuned to the apply → email → track pipeline.
 */
export function buildResearchPrompt(j: JobListing): string {
  const where = j.location ? ` (${j.location})` : "";
  // Give Claude the real posting so the email is tailored, not generic. Cap it
  // so a huge description doesn't blow up the prompt.
  const desc = j.description
    ? j.description.slice(0, 4000) + (j.description.length > 4000 ? "…" : "")
    : "(no description captured — infer from the title/company and note assumptions)";
  const link = j.apply_url ? `\nJob link: ${j.apply_url}` : "";

  return `I'm applying for the ${j.title} role at ${j.company}${where}. Use MY RÉSUMÉ from this project's knowledge — do not invent any experience I don't have. Give me a QUICK-SCAN brief with short headers and tables so I can read → confirm → send fast.

--- THE JOB ---
Title: ${j.title}
Company: ${j.company}${where}${link}
Description:
${desc}
--- END JOB ---

1. READY-TO-SEND EMAIL  (put this FIRST — I want to copy-paste and send)
   - Write a short, specific outreach email from ME to the hiring team, tailored to THIS description and grounded in MY résumé (name 1–2 concrete things from my background that match what they need).
   - Give me: a Subject line, and a Body I can paste as-is. Keep it tight (120–160 words), confident, no fluff, no made-up facts.
   - If a real recipient name isn't known, address it generically ("Hi [Hiring Manager]") and tell me who to swap in.

2. WHO TO EMAIL  (make this dead easy)
   - Give a table: | Contact | Address / pattern | Notes | — the careers/recruiting inbox if there is one, plus the company's likely corporate email PATTERN (e.g. firstname.lastname@domain) so I can reach a real person.
   - Be honest: do NOT invent a specific person's address. Give the pattern and tell me to confirm the name first.

3. WHERE ELSE TO APPLY
   - Table: | Source | Link | Why | — everywhere this exact role is posted (company careers page, LinkedIn, Indeed, ZipRecruiter, Glassdoor). Say which listing is most complete and where it's best to apply (apply direct on the company site if it's listed there).
   - Also: other OPEN roles at ${j.company} I should apply to, and similar roles at nearby / competing companies worth a look.

4. FIND THE PERSON
   - Likely hiring-manager / team-lead titles for this role and the exact LinkedIn search terms to find the real human.

Keep everything concrete, skimmable, and true to my résumé.`;
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
  const toggleFlag = useToggleResearchFlag();
  const toggleEmailed = useToggleEmailed();
  const { data: profile } = useProfile();
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data: stages = [] } = usePipelineStages();

  // Open the user's mail client pre-filled with a subject, and auto-mark the
  // job "Emailed" — that's the seamless loop (research gives the address + draft,
  // this opens compose so they paste + send, tracking fills itself in).
  const composeEmail = () => {
    const subject = `Application for ${j.title} at ${j.company}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
    if (!savedJob.emailed_at) {
      toggleEmailed.mutate({
        savedJobId: savedJob.id,
        emailedAt: new Date().toISOString(),
      });
    }
  };

  const researchWithClaude = async () => {
    const prompt = buildResearchPrompt(j);
    try {
      await navigator.clipboard.writeText(prompt);
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
      <DialogContent className="max-h-[88vh] gap-5 overflow-y-auto sm:max-w-xl">
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
          </div>
        </DialogHeader>

        {/* Why it's in that stage: the emails behind it, first. */}
        <JobEmails jobListingId={savedJob.job_listing_id} sayWhenNone />

        {/* What you can do with it. */}
        <section className="space-y-2">
          <SectionTitle>Actions</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {j.apply_url && (
              <Button asChild className="gap-1.5 sm:col-span-2">
                <a href={j.apply_url} target="_blank" rel="noopener noreferrer">
                  Open job posting{" "}
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </Button>
            )}
            {savedJob.emailed_at ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 text-sm">
                <span className="flex items-center gap-1.5">
                  <MailCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                  Emailed {format(new Date(savedJob.emailed_at), "MMM d")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    toggleEmailed.mutate({
                      savedJobId: savedJob.id,
                      emailedAt: null,
                    })
                  }
                >
                  Undo
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={composeEmail}
              >
                <Mail className="h-4 w-4" aria-hidden /> Write to the company
              </Button>
            )}
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={researchWithClaude}
              disabled={!fullListing && loadingDescription}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {copied
                ? "Copied. Paste it in Claude"
                : "Research it with Claude"}
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
              {savedJob.flagged_for_research
                ? "Remove from Contact Further"
                : "Add to Contact Further"}
            </Button>
            <Button asChild variant="outline" className="justify-start gap-2">
              <Link to={`/jobs/${savedJob.job_listing_id}`}>
                <Maximize2 className="h-4 w-4" aria-hidden /> Open the full page
              </Link>
            </Button>
            {!savedJob.emailed_at && (
              <button
                type="button"
                onClick={() =>
                  toggleEmailed.mutate({
                    savedJobId: savedJob.id,
                    emailedAt: new Date().toISOString(),
                  })
                }
                className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground sm:col-span-2"
              >
                I already emailed them
              </button>
            )}
          </div>
        </section>

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
