import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { KanbanCard } from "@/components/tracker/KanbanCard";
import type { JobEmailLatest } from "@/hooks/useEmailAccount";
import { PAGE_SIZE, columnView } from "@/lib/boardFilter";
import { stageTone } from "@/lib/stageStyle";
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
  /** This stage's jobs that match the search; null when no search is on. */
  hits: SavedJob[] | null;
  /** The card the search just jumped to. */
  pulseId: string | null;
  /** The email behind each job's stage, by saved-job id. */
  emails?: Map<string, JobEmailLatest>;
  onMoveJob: (savedJobId: string, stageId: string) => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMove?: (dir: -1 | 1) => void;
}

export function PipelineColumn({
  stage,
  jobs,
  stages,
  followUpDays,
  words,
  hits,
  pulseId,
  emails,
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
  const tone = stageTone(stage.name);
  const view = columnView(jobs, hits, limit);
  const found = view.hitIds?.size ?? 0;

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
          "flex w-10 shrink-0 snap-start flex-col items-center gap-2.5 rounded-xl bg-muted/40 py-3 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
          isOver && "bg-primary/10 ring-2 ring-primary/60",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden />
        <span className="text-sm font-medium [writing-mode:vertical-rl]">{stage.name}</span>
        <span className="text-xs tabular-nums">0</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // One quiet panel per stage; the stage's colour is the dot by its name.
        "group/col flex min-h-0 w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-xl bg-muted/40 transition-colors sm:w-72",
        isOver && "bg-primary/10 ring-2 ring-primary/60",
      )}
    >
      {/* Column header */}
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
          <span className="truncate text-sm font-semibold">{stage.name}</span>
          <span
            className={cn(
              "whitespace-nowrap rounded-full px-1.5 text-xs font-medium tabular-nums text-muted-foreground",
              found > 0 && "bg-primary text-primary-foreground",
            )}
          >
            {view.hitIds ? `${found} of ${jobs.length}` : jobs.length}
          </span>
          {/* Reorder this column (◀ ▶): there when you point at the column. */}
          <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/col:opacity-100 pointer-coarse:opacity-100">
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
          </div>
        </div>
      </div>

      {/* Cards: this part scrolls, the header above stays put. */}
      <div
        ref={scroller}
        className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {view.visible.map((sj) => {
          // A job with no stage is only shown here; it isn't in this stage yet.
          const here = sj.pipeline_stage_id === stage.id;
          return (
            <KanbanCard
              key={sj.id}
              savedJob={sj}
              followUpDays={followUpDays}
              stageName={here ? stage.name : null}
              stages={stages}
              stageId={here ? stage.id : null}
              onMove={(stageId) => onMoveJob(sj.id, stageId)}
              words={words}
              dimmed={view.hitIds !== null && !view.hitIds.has(sj.id)}
              pulse={pulseId === sj.id}
              email={emails?.get(sj.id)}
            />
          );
        })}

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
