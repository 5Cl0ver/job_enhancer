import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Building2, Clock, AlertTriangle, MapPin, Search, MailCheck } from "lucide-react";
import { formatDistanceToNow, differenceInDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { JobDetailDialog } from "@/components/tracker/JobDetailDialog";
import { useToggleResearchFlag } from "@/hooks/useTracker";
import { getNextAction, TONE_STYLES } from "@/lib/nextAction";
import { cn } from "@/lib/utils";
import type { SavedJob } from "@/types/api";

interface KanbanCardProps {
  savedJob: SavedJob;
  followUpDays: number;
  /** The name of the stage this card sits in — drives the "next action" pill. */
  stageName?: string | null;
}

export function KanbanCard({ savedJob, followUpDays, stageName }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: savedJob.id });
  const [open, setOpen] = useState(false);
  const toggleFlag = useToggleResearchFlag();
  // Distinguish a click from a drag: only open the detail if the pointer barely
  // moved (a drag moves ≥5px and is handled by dnd-kit instead).
  const downPos = useRef<{ x: number; y: number } | null>(null);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const { job_listing, last_stage_change, applied_at, flagged_for_research, emailed_at } = savedJob;

  const daysSinceStageChange = differenceInDays(new Date(), new Date(last_stage_change));
  const isFollowUpOverdue = daysSinceStageChange >= followUpDays;
  const appliedAgo = applied_at
    ? formatDistanceToNow(new Date(applied_at), { addSuffix: true })
    : null;

  // The CRM "next step" for this card (what to do / who's ghosting you).
  const nextAction = getNextAction(savedJob, { followUpDays, stageName: stageName ?? null });

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn("touch-none", isDragging && "opacity-50")}
      >
        <Card
          onPointerDownCapture={(e) => {
            downPos.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={(e) => {
            const d = downPos.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // was a drag
            setOpen(true);
          }}
          className={cn(
            "cursor-pointer border shadow-sm transition-shadow hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
            flagged_for_research && "border-amber-300 ring-1 ring-amber-200",
          )}
        >
          <CardContent className="p-3">
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-1">
                <p className="line-clamp-2 text-sm font-medium leading-tight">
                  {job_listing.title}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  {isFollowUpOverdue && (
                    <span
                      aria-label="Follow-up overdue"
                      title={`No activity for ${daysSinceStageChange} days`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    </span>
                  )}
                  {/* Quick "Contact Further" flag toggle (doesn't open the detail). */}
                  <button
                    type="button"
                    aria-label={
                      flagged_for_research ? "Remove from Contact Further" : "Add to Contact Further"
                    }
                    title={
                      flagged_for_research ? "In Contact Further — research shortlist" : "Add to Contact Further"
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFlag.mutate({
                        savedJobId: savedJob.id,
                        flagged: !flagged_for_research,
                      });
                    }}
                    className={cn(
                      "rounded p-0.5 hover:bg-muted",
                      flagged_for_research ? "text-amber-600" : "text-muted-foreground/50",
                    )}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{job_listing.company}</span>
              </div>

              {job_listing.location && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{job_listing.location}</span>
                </div>
              )}

              {job_listing.is_remote && (
                <Badge variant="secondary" className="text-xs">
                  Remote
                </Badge>
              )}

              {appliedAgo && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>Applied {appliedAgo}</span>
                </div>
              )}

              {emailed_at && (
                <div className="flex items-center gap-1 text-xs text-emerald-600">
                  <MailCheck className="h-3 w-3 shrink-0" />
                  <span>Emailed {format(new Date(emailed_at), "MMM d")}</span>
                </div>
              )}

              {/* CRM next-action pill — tells you the next move at a glance. */}
              {nextAction && (
                <div
                  className={cn(
                    "mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    TONE_STYLES[nextAction.tone],
                  )}
                  title="Suggested next step"
                >
                  {nextAction.label}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <JobDetailDialog savedJob={savedJob} open={open} onOpenChange={setOpen} />
    </>
  );
}
