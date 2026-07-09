"use client";

import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveJob, useUnsaveJob, useSavedJobId } from "@/hooks/useSavedJobs";
import { cn } from "@/lib/utils";

interface SaveButtonProps {
  jobId: string;
  className?: string;
  variant?: "icon" | "button";
}

export function SaveButton({ jobId, className, variant = "button" }: SaveButtonProps) {
  const { savedJobId, isLoading: checkLoading } = useSavedJobId(jobId);
  const saveJob = useSaveJob();
  const unsaveJob = useUnsaveJob();

  const isSaved = !!savedJobId;
  const isPending = saveJob.isPending || unsaveJob.isPending || checkLoading;

  const handleClick = () => {
    if (isSaved && savedJobId) {
      unsaveJob.mutate(savedJobId);
    } else {
      saveJob.mutate({ job_listing_id: jobId });
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={handleClick}
        disabled={isPending}
        aria-label={isSaved ? "Remove from saved" : "Save job"}
        className={cn(
          "rounded-full p-1.5 transition-colors hover:bg-muted",
          isSaved && "text-primary",
          className,
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isSaved ? (
          <BookmarkCheck className="h-4 w-4" />
        ) : (
          <Bookmark className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <Button
      variant={isSaved ? "default" : "outline"}
      size="sm"
      onClick={handleClick}
      disabled={isPending}
      className={cn("h-8 gap-1.5", className)}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isSaved ? (
        <BookmarkCheck className="h-3.5 w-3.5" />
      ) : (
        <Bookmark className="h-3.5 w-3.5" />
      )}
      {isSaved ? "Saved" : "Save"}
    </Button>
  );
}
