import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { KanbanCard } from "@/components/tracker/KanbanCard";
import { PAGE_SIZE, columnView, matchesSearch } from "@/lib/boardFilter";
import { cn } from "@/lib/utils";
import type { PipelineStage, SavedJob } from "@/types/api";

interface PipelineColumnProps {
  stage: PipelineStage;
  jobs: SavedJob[];
  /** Every stage column, for each card's "Move to" menu. */
  stages: PipelineStage[];
  followUpDays: number;
  /** Search words; empty when no search is on. */
  words: string[];
  /** The card the search just jumped to. */
  pulseId: string | null;
  onMoveJob: (savedJobId: string, stageId: string) => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMove?: (dir: -1 | 1) => void;
}

const STAGE_COLORS: Record<string, string> = {
  Interested: "bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-800",
  "Referral Sent": "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900",
  Applied: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",
  "Phone Screen": "bg-cyan-50 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-900",
  "Take-Home Assignment": "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-900",
  Interview: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900",
  Offer: "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900",
  Rejected: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
};

export function PipelineColumn({
  stage,
  jobs,
  stages,
  followUpDays,
  words,
  pulseId,
  onMoveJob,
  canMoveLeft,
  canMoveRight,
  onMove,
}: PipelineColumnProps) {
  // The whole column is the drop target (never the cards inside it), so a card
  // dropped anywhere in it, including on top of another card, lands here.
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [opened, setOpened] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const columnColor = stage.color ? undefined : STAGE_COLORS[stage.name];
  const view = columnView(jobs, words, limit);
  const searching = words.length > 0;

  // Add the next page when the "Show more" button scrolls into view.
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE_SIZE);
      },
      { root: scroller.current, rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [limit, view.hidden]);

  // An empty stage takes a narrow strip, not a whole column. It still takes drops.
  if (jobs.length === 0 && !opened) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => setOpened(true)}
        title={`${stage.name}: no jobs. Drop a job here, or click to open.`}
        className={cn(
          "flex w-11 shrink-0 snap-start flex-col items-center gap-2 rounded-lg border py-2 transition-shadow",
          columnColor ?? "border-border bg-muted",
          isOver && "ring-2 ring-primary",
        )}
      >
        <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-medium">0</span>
        <span className="text-sm font-semibold [writing-mode:vertical-rl]">{stage.name}</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-lg transition-shadow sm:w-64",
        isOver && "ring-2 ring-primary",
      )}
    >
      {/* Column header */}
      <div className={cn("rounded-t-lg border px-3 py-2", columnColor ?? "border-border bg-muted")}>
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
            <span
              className={cn(
                "whitespace-nowrap rounded-full bg-background px-1.5 py-0.5 text-xs font-medium",
                searching && view.matches > 0 && "bg-primary text-primary-foreground",
              )}
            >
              {searching ? `${view.matches} of ${jobs.length}` : jobs.length}
            </span>
          </div>
        </div>
      </div>

      {/* Cards: this part scrolls, the header above stays put. */}
      <div
        ref={scroller}
        className={cn(
          "flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-b-lg border border-t-0 p-2 transition-colors",
          columnColor ?? "border-border",
          isOver && "bg-muted/60",
        )}
      >
        {view.visible.map((sj) => (
          <KanbanCard
            key={sj.id}
            savedJob={sj}
            followUpDays={followUpDays}
            stageName={stage.name}
            stages={stages}
            stageId={stage.id}
            onMove={(stageId) => onMoveJob(sj.id, stageId)}
            words={words}
            dimmed={searching && !matchesSearch(sj, words)}
            pulse={pulseId === sj.id}
          />
        ))}

        {view.hidden > 0 && (
          <button
            ref={more}
            type="button"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="shrink-0 rounded-md border border-dashed py-2 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground"
          >
            Show more ({view.hidden} left)
          </button>
        )}

        {jobs.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">Drop jobs here</p>
        )}
      </div>
    </div>
  );
}
