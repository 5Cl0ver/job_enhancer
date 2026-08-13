import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { KanbanCard } from "@/components/tracker/KanbanCard";
import { cn } from "@/lib/utils";
import type { PipelineStage, SavedJob } from "@/types/api";

interface PipelineColumnProps {
  stage: PipelineStage;
  jobs: SavedJob[];
  followUpDays: number;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMove?: (dir: -1 | 1) => void;
}

const STAGE_COLORS: Record<string, string> = {
  Interested: "bg-slate-50 border-slate-200",
  "Referral Sent": "bg-purple-50 border-purple-200",
  Applied: "bg-blue-50 border-blue-200",
  "Phone Screen": "bg-cyan-50 border-cyan-200",
  "Take-Home Assignment": "bg-yellow-50 border-yellow-200",
  Interview: "bg-orange-50 border-orange-200",
  Offer: "bg-green-50 border-green-200",
  Rejected: "bg-red-50 border-red-200",
};

export function PipelineColumn({
  stage,
  jobs,
  followUpDays,
  canMoveLeft,
  canMoveRight,
  onMove,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const jobIds = jobs.map((j) => j.id);
  const columnColor = stage.color
    ? undefined
    : STAGE_COLORS[stage.name];

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      {/* Column header */}
      <div className={cn("group rounded-t-lg border px-3 py-2", columnColor ?? "bg-muted border-border")}>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-sm font-semibold">{stage.name}</span>
          <div className="flex items-center gap-0.5">
            {/* Reorder this column (◀ ▶). */}
            <button
              type="button"
              aria-label="Move stage left"
              disabled={!canMoveLeft}
              onClick={() => onMove?.(-1)}
              className="rounded p-0.5 text-muted-foreground/60 hover:bg-background hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Move stage right"
              disabled={!canMoveRight}
              onClick={() => onMove?.(1)}
              className="rounded p-0.5 text-muted-foreground/60 hover:bg-background hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-medium">
              {jobs.length}
            </span>
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[120px] flex-col gap-2 rounded-b-lg border border-t-0 p-2 transition-colors",
          columnColor ?? "border-border",
          isOver && "bg-muted/60",
        )}
      >
        <SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
          {jobs.map((sj) => (
            <KanbanCard
              key={sj.id}
              savedJob={sj}
              followUpDays={followUpDays}
              stageName={stage.name}
            />
          ))}
        </SortableContext>

        {jobs.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Drop jobs here
          </p>
        )}
      </div>
    </div>
  );
}
