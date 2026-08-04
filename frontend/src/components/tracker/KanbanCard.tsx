import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Building2, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SavedJob } from "@/types/api";

interface KanbanCardProps {
  savedJob: SavedJob;
  followUpDays: number;
}

export function KanbanCard({ savedJob, followUpDays }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: savedJob.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const { job_listing, last_stage_change, applied_at } = savedJob;

  const daysSinceStageChange = differenceInDays(
    new Date(),
    new Date(last_stage_change),
  );
  const isFollowUpOverdue = daysSinceStageChange >= followUpDays;

  const appliedAgo = applied_at
    ? formatDistanceToNow(new Date(applied_at), { addSuffix: true })
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging && "opacity-50")}
    >
      <Card className="cursor-grab border shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing">
        <CardContent className="p-3">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-1">
              <p className="line-clamp-2 text-sm font-medium leading-tight">
                {job_listing.title}
              </p>
              {isFollowUpOverdue && (
                <span
                  aria-label="Follow-up overdue"
                  title={`No activity for ${daysSinceStageChange} days`}
                  className="shrink-0"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{job_listing.company}</span>
            </div>

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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
