import { type MouseEvent, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useSavedJobId, useSaveJob } from "@/hooks/useSavedJobs";
import { useMoveJobStage, usePipelineStages } from "@/hooks/useTracker";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobListing } from "@/types/api";

/** How often the app looks whether the application's tab is still open. */
const WATCH_MS = 1_500;

/**
 * Open the posting in a new tab the app can watch (spec 040): only whether
 * it's still open, nothing in it. The new tab can't reach back to this one
 * (opener cleared), like rel="noopener". Null when the browser blocked it.
 */
export function openWatched(url: string): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.location.href = url;
  } catch {
    tab.close();
    return null;
  }
  return tab;
}

interface ApplyButtonProps extends Pick<ButtonProps, "size" | "variant"> {
  job: JobListing;
  className?: string;
  /** The job was made from an email, so its link is that email, not a posting:
   * the button says so and doesn't ask "Did you apply?" afterwards. */
  fromEmail?: boolean;
}

/**
 * "Apply Now" link with the FR-006a confirmation: opens the external
 * posting, and asks "Did you apply?" only once the user is done with it
 * (spec 040): when they close the application's tab, never just on coming
 * back to this tab mid-application. Job Catcher moves the job to Applied by
 * itself when it sees the confirmation page; then nothing is asked. Until
 * then a quiet "I applied" sits by the button. Status is NEVER changed
 * without confirmation.
 */
export function ApplyButton({ job, className, size, variant, fromEmail }: ApplyButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Pressed Apply Now and not answered yet: the quiet "I applied" shows.
  const [pending, setPending] = useState(false);
  const tab = useRef<Window | null>(null);

  const { savedJobId, savedJob } = useSavedJobId(job.id);
  const { data: stages } = usePipelineStages();
  const saveJob = useSaveJob();
  const moveStage = useMoveJobStage();

  const busy = saveJob.isPending || moveStage.isPending;
  const appliedStage = stages?.find((s) => s.name === "Applied");
  // Job Catcher saw the confirmation page and moved it: nothing to ask.
  const applied = !!savedJob?.applied_at || (!!appliedStage && savedJob?.pipeline_stage_id === appliedStage.id);

  // The application's tab closed: now ask (unless it's already Applied).
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (tab.current?.closed) {
        tab.current = null;
        clearInterval(t);
        setConfirmOpen(true);
      }
    }, WATCH_MS);
    return () => clearInterval(t);
  }, [pending]);

  function handleApplyClick(e: MouseEvent<HTMLAnchorElement>) {
    const opened = openWatched(job.apply_url);
    // Blocked: the link opens as usual; the quiet "I applied" still shows.
    if (opened) e.preventDefault();
    tab.current = opened;
    setPending(true);
  }

  async function markApplied() {
    if (!appliedStage) {
      setConfirmOpen(false);
      return;
    }
    try {
      let sjId = savedJobId;
      if (!sjId) {
        const sj = await saveJob.mutateAsync({ job_listing_id: job.id });
        sjId = sj.id;
      }
      await moveStage.mutateAsync({ savedJobId: sjId, stageId: appliedStage.id });
    } finally {
      setConfirmOpen(false);
      setPending(false);
    }
  }

  return (
    <>
      <Button asChild size={size} variant={variant} className={className}>
        <a
          href={job.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={fromEmail ? undefined : handleApplyClick}
        >
          {fromEmail ? "Open the email" : "Apply Now"}
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </a>
      </Button>

      {pending && !applied && !confirmOpen && appliedStage && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setConfirmOpen(true)}
        >
          I applied
        </Button>
      )}

      <Dialog open={confirmOpen && !applied} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Did you apply?</DialogTitle>
            <DialogDescription>
              {job.title} at {job.company}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmOpen(false);
                setPending(false);
              }}
            >
              Not yet
            </Button>
            <Button onClick={markApplied} disabled={busy || !appliedStage}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Yes — mark as Applied
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
