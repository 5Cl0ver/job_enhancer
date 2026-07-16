"use client";

import { useRef, useState } from "react";
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

/** Minimum time away (ms) before we assume they actually visited the posting. */
const MIN_AWAY_MS = 3_000;

interface ApplyButtonProps extends Pick<ButtonProps, "size" | "variant"> {
  job: JobListing;
  className?: string;
}

/**
 * "Apply Now" link with the FR-006a confirmation: opens the external
 * posting, and when the user returns to this tab asks "Did you apply?" —
 * one click saves the job (if needed) and moves it to Applied.
 * Status is NEVER changed without confirmation.
 */
export function ApplyButton({ job, className, size, variant }: ApplyButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const clickedAt = useRef<number | null>(null);

  const { savedJobId } = useSavedJobId(job.id);
  const { data: stages } = usePipelineStages();
  const saveJob = useSaveJob();
  const moveStage = useMoveJobStage();

  const busy = saveJob.isPending || moveStage.isPending;
  const appliedStage = stages?.find((s) => s.name === "Applied");

  function handleApplyClick() {
    clickedAt.current = Date.now();
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      if (clickedAt.current && Date.now() - clickedAt.current > MIN_AWAY_MS) {
        setConfirmOpen(true);
      }
      clickedAt.current = null;
    };
    window.addEventListener("focus", onFocus);
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
    }
  }

  return (
    <>
      <Button asChild size={size} variant={variant} className={className}>
        <a
          href={job.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleApplyClick}
        >
          Apply Now
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </a>
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Did you apply?</DialogTitle>
            <DialogDescription>
              {job.title} at {job.company}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
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
