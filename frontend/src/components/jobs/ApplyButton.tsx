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
/** "Closed" this soon after opening: the site cut the link to its tab
 * (Cross-Origin-Opener-Policy, e.g. Google, Glassdoor), not the user. */
const CUT_OFF_MS = 10_000;

/** Only a web address (http or https) is ever opened: never javascript:. */
export function webUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Open the posting in a new tab the app can watch (spec 040): only whether
 * it's still open, nothing in it. The new tab can't reach back to this one
 * (opener cleared) and gets no referrer, like rel="noopener noreferrer". Null
 * when the browser blocked it or the link isn't a web address.
 */
export function openWatched(url: string): Window | null {
  const href = webUrl(url);
  if (!href) return null;
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    // Followed from the blank tab itself with rel="noreferrer": the employer's
    // site isn't told which app page sent it.
    const doc = tab.document;
    if (doc?.createElement && doc.body) {
      const a = doc.createElement("a");
      a.href = href;
      a.rel = "noreferrer";
      doc.body.appendChild(a);
      a.click();
    } else {
      tab.location.href = href;
    }
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
  /** The quiet "I applied" by the button. Off where Applied is already one
   * tap away (a job card's toggle, the phone bar's stage). */
  showApplied?: boolean;
}

/**
 * "Apply Now" link with the FR-006a confirmation: opens the external
 * posting, and asks "Did you apply?" only once the user is done with it
 * (spec 040): when they close the application's tab, never just on coming
 * back to this tab mid-application. Job Catcher moves the job to Applied by
 * itself when it sees the confirmation page; then nothing is asked. A site
 * that cuts the link to its tab at once (Cross-Origin-Opener-Policy) can't
 * be watched: nothing is asked. Until then a quiet "I applied" sits by the
 * button (where Applied isn't already one tap away). Status is NEVER changed
 * without confirmation.
 */
export function ApplyButton({ job, className, size, variant, fromEmail, showApplied = true }: ApplyButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Pressed Apply Now and not answered yet: the quiet "I applied" shows.
  const [pending, setPending] = useState(false);
  const tab = useRef<Window | null>(null);
  const openedAt = useRef(0);

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
        // Cut off at once: the app can't tell when it's done, so it never
        // asks (the quiet "I applied" stays).
        if (Date.now() - openedAt.current >= CUT_OFF_MS) setConfirmOpen(true);
      }
    }, WATCH_MS);
    return () => clearInterval(t);
  }, [pending]);

  function handleApplyClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!webUrl(job.apply_url)) {
      e.preventDefault(); // not a web address: never followed
      return;
    }
    const opened = openWatched(job.apply_url);
    // Blocked: the link opens as usual; the quiet "I applied" still shows.
    if (opened) e.preventDefault();
    tab.current = opened;
    openedAt.current = Date.now();
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
          href={webUrl(job.apply_url) ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={fromEmail ? undefined : handleApplyClick}
        >
          {fromEmail ? "Open the email" : "Apply Now"}
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </a>
      </Button>

      {showApplied && pending && !applied && !confirmOpen && appliedStage && (
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
