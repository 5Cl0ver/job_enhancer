import { useState } from "react";
import { Building2, MapPin, ExternalLink, Search, Check, Copy, Mail, MailCheck } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToggleResearchFlag, useToggleEmailed } from "@/hooks/useTracker";
import { useProfile } from "@/hooks/useProfile";
import type { JobListing, SavedJob } from "@/types/api";

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

export function salaryText(j: JobListing): string | null {
  if (!j.salary_min && !j.salary_max) return null;
  const per = j.salary_period === "hourly" ? "/hr" : "/yr";
  if (j.salary_min && j.salary_max) return `${money(j.salary_min)}–${money(j.salary_max)} ${per}`;
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
  const j = savedJob.job_listing;
  const pay = salaryText(j);
  const toggleFlag = useToggleResearchFlag();
  const toggleEmailed = useToggleEmailed();
  const { data: profile } = useProfile();
  const [copied, setCopied] = useState(false);

  // Open the user's mail client pre-filled with a subject, and auto-mark the
  // job "Emailed" — that's the seamless loop (research gives the address + draft,
  // this opens compose so they paste + send, tracking fills itself in).
  const composeEmail = () => {
    const subject = `Application for ${j.title} at ${j.company}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
    if (!savedJob.emailed_at) {
      toggleEmailed.mutate({ savedJobId: savedJob.id, emailedAt: new Date().toISOString() });
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
    window.open(url && /^https?:\/\//i.test(url) ? url : "https://claude.ai/new", "_blank", "noopener");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 text-lg leading-snug">{j.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> {j.company}
            </span>
            {j.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {j.location}
              </span>
            )}
            {j.is_remote && <Badge variant="secondary">Remote</Badge>}
            {pay && <span className="font-medium text-foreground">{pay}</span>}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {savedJob.applied_at && (
              <span>Applied {format(new Date(savedJob.applied_at), "MMM d, yyyy")}</span>
            )}
            <span>Saved {format(new Date(savedJob.created_at), "MMM d, yyyy")}</span>
          </div>

          {/* Contact Further: research shortlist flag + Claude research */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
            <Button
              variant={savedJob.flagged_for_research ? "default" : "outline"}
              size="sm"
              onClick={() =>
                toggleFlag.mutate({
                  savedJobId: savedJob.id,
                  flagged: !savedJob.flagged_for_research,
                })
              }
            >
              <Search className="mr-1 h-4 w-4" />
              {savedJob.flagged_for_research ? "In Contact Further" : "Add to Contact Further"}
            </Button>
            <Button variant="secondary" size="sm" onClick={researchWithClaude}>
              {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
              {copied ? "Copied — paste in Claude" : "🔍 Research + draft email (Claude)"}
            </Button>

            {/* Outreach email tracking — the seamless send loop. */}
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-amber-200/70 pt-2 dark:border-amber-900/40">
              {savedJob.emailed_at ? (
                <>
                  <Badge variant="secondary" className="gap-1">
                    <MailCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Emailed {format(new Date(savedJob.emailed_at), "MMM d, yyyy")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleEmailed.mutate({ savedJobId: savedJob.id, emailedAt: null })}
                  >
                    Undo
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={composeEmail}>
                    <Mail className="mr-1 h-4 w-4" />
                    Compose email
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      toggleEmailed.mutate({
                        savedJobId: savedJob.id,
                        emailedAt: new Date().toISOString(),
                      })
                    }
                  >
                    Mark as emailed
                  </Button>
                </>
              )}
            </div>
          </div>

          {savedJob.notes && (
            <div className="rounded-md border bg-muted/40 p-2.5">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Your notes</p>
              <p className="whitespace-pre-wrap">{savedJob.notes}</p>
            </div>
          )}

          {j.description ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Description</p>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
                {j.description}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No description saved for this job.</p>
          )}

          {j.apply_url && (
            <Button asChild className="w-full">
              <a href={j.apply_url} target="_blank" rel="noopener noreferrer">
                Open job posting <ExternalLink className="ml-1 h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
