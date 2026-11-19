import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Briefcase, Plus, Search, MailCheck, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineColumn } from "@/components/tracker/PipelineColumn";
import { CardFace } from "@/components/tracker/KanbanCard";
import { JobDetailDialog } from "@/components/tracker/JobDetailDialog";
import {
  usePipelineStages,
  useKanbanJobs,
  useMoveJobStage,
  useCreateStage,
  useToggleResearchFlag,
  useUpdateStage,
} from "@/hooks/useTracker";
import { useProfile } from "@/hooks/useProfile";
import { matchesSearch, searchWords, stageFor } from "@/lib/boardFilter";
import { cn } from "@/lib/utils";
import type { PipelineStage, SavedJob } from "@/types/api";

const DEFAULT_FOLLOW_UP_DAYS = 7;
const RESEARCH_DROP_ID = "research-flag";
// A stage the user may have created by hand before this became a built-in flag.
const CONTACT_FURTHER = /^contact\s*further$/i;
/** How long the card a search jumped to keeps flashing. */
const PULSE_MS = 2000;

// The column under the pointer wins; when the pointer is between columns, the
// one the dragged card overlaps most.
const underPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

function AddStageDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createStage = useCreateStage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createStage.mutate(
      { name: name.trim() },
      { onSuccess: () => { setOpen(false); setName(""); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Stage
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Pipeline Stage</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="stage-name">Stage name</Label>
            <Input
              id="stage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Coding Challenge"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || createStage.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A compact, non-draggable mirror card for the Contact Further column. */
function ResearchMiniCard({ savedJob }: { savedJob: SavedJob }) {
  const [open, setOpen] = useState(false);
  const toggleFlag = useToggleResearchFlag();
  const j = savedJob.job_listing;
  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-md border bg-card p-2.5 shadow-sm transition-shadow hover:border-amber-300 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-1">
          <p className="line-clamp-2 text-sm font-medium leading-tight">{j.title}</p>
          <button
            type="button"
            title="Remove from Contact Further"
            onClick={(e) => {
              e.stopPropagation();
              toggleFlag.mutate({ savedJobId: savedJob.id, flagged: false });
            }}
            className="shrink-0 rounded px-1 text-muted-foreground/60 hover:text-destructive"
          >
            ✕
          </button>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[j.company, j.location].filter(Boolean).join(" · ")}
        </p>
        {savedJob.emailed_at && (
          <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
            <MailCheck className="h-3 w-3 shrink-0" />
            Emailed {format(new Date(savedJob.emailed_at), "MMM d")}
          </p>
        )}
      </div>
      <JobDetailDialog savedJob={savedJob} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The built-in "Contact Further" research shortlist — a flag, not a stage. */
function ResearchColumn({ jobs }: { jobs: SavedJob[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: RESEARCH_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-lg transition-shadow sm:w-64",
        isOver && "ring-2 ring-amber-400",
      )}
    >
      <div className="rounded-t-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <Search className="h-3.5 w-3.5" /> Contact Further
          </span>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-medium">
            {jobs.length}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-b-lg border border-t-0 border-amber-200 bg-amber-50/40 p-2 transition-colors dark:border-amber-900 dark:bg-amber-950/20",
          isOver && "bg-amber-100/70 dark:bg-amber-900/30",
        )}
      >
        {jobs.map((sj) => (
          <ResearchMiniCard key={sj.id} savedJob={sj} />
        ))}
        {jobs.length === 0 && (
          <p className="py-4 text-center text-xs text-amber-700/70 dark:text-amber-500/70">
            Drop a job here to research the company
          </p>
        )}
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden" aria-busy aria-label="Loading your jobs">
      {[5, 3, 4, 2].map((cards, i) => (
        <div key={i} className="flex w-64 shrink-0 flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: cards }, (_, n) => (
            <Skeleton key={n} className="h-24 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KanbanBoard() {
  const stagesQuery = usePipelineStages();
  const jobsQuery = useKanbanJobs();
  const stages = stagesQuery.data ?? [];
  const savedJobs = jobsQuery.data ?? [];
  const { data: profile } = useProfile();
  // Use the user's real follow-up cadence (Settings), not a hardcoded 7 days.
  const followUpDays = profile?.follow_up_days ?? DEFAULT_FOLLOW_UP_DAYS;
  const moveJob = useMoveJobStage();
  const toggleFlag = useToggleResearchFlag();
  const updateStage = useUpdateStage();
  const [activeJob, setActiveJob] = useState<SavedJob | null>(null);

  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  // Typing stays instant; the cards catch up a moment later.
  const words = searchWords(useDeferredValue(query));
  const searchBox = useRef<HTMLInputElement>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);

  // A mouse drags after 5px; a finger drags after a short press, so a swipe
  // still scrolls the column.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // "/" jumps to the search box from anywhere on the board.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.closest("input, textarea, select, [contenteditable='true']");
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!pulseId) return;
    const timer = window.setTimeout(() => setPulseId(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseId]);

  // A hand-made "Contact Further" stage is now superseded by the built-in flag
  // column: hide it from the normal columns and fold its jobs into the flag.
  const normalStages = stages.filter((s) => !CONTACT_FURTHER.test(s.name));
  const cfStageIds = new Set(
    stages.filter((s) => CONTACT_FURTHER.test(s.name)).map((s) => s.id),
  );
  const inContactStage = (sj: SavedJob) =>
    sj.pipeline_stage_id != null && cfStageIds.has(sj.pipeline_stage_id);
  const researchJobs = savedJobs.filter((sj) => sj.flagged_for_research || inContactStage(sj));

  const stageIds = normalStages.map((s) => s.id);
  const columns = new Map<string, SavedJob[]>(stageIds.map((id) => [id, []]));
  for (const sj of savedJobs) {
    if (inContactStage(sj)) continue;
    const id = stageFor(sj, stageIds);
    if (id) columns.get(id)?.push(sj);
  }
  // Each stage's matches, worked out once per search and shared with its column.
  const hitsIn = (list: string[]) =>
    new Map(
      stageIds.map((id) => [id, (columns.get(id) ?? []).filter((sj) => matchesSearch(sj, list))]),
    );
  const hits = words.length > 0 ? hitsIn(words) : null;
  const matchCount = hits ? [...hits.values()].reduce((n, list) => n + list.length, 0) : 0;

  // mutateAsync, so every failed move reports itself even when several are in
  // flight (per-call callbacks only fire for the latest one).
  const move = (savedJobId: string, stageId: string) => {
    moveJob.mutateAsync({ savedJobId, stageId }).catch(() =>
      toast.error("Couldn't move that job. It's back where it was.", {
        action: { label: "Retry", onClick: () => move(savedJobId, stageId) },
      }),
    );
  };

  const flag = (savedJobId: string) => {
    toggleFlag.mutateAsync({ savedJobId, flagged: true }).catch(() =>
      toast.error("Couldn't add that job to Contact Further.", {
        action: { label: "Retry", onClick: () => flag(savedJobId) },
      }),
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJob(savedJobs.find((sj) => sj.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragged = activeJob;
    setActiveJob(null);
    if (!over || !dragged) return;
    if (over.id === RESEARCH_DROP_ID) {
      // Dropping onto Contact Further FLAGS the job (keeps its real stage).
      if (!dragged.flagged_for_research) flag(String(active.id));
      return;
    }
    // Only columns take drops, so `over` is always a stage. A job with no stage
    // can be dropped on the column it's shown in, which gives it that stage.
    const target = String(over.id);
    if (stageIds.includes(target) && target !== dragged.pipeline_stage_id) {
      move(dragged.id, target);
    }
  };

  // Swap this stage's sort_order with its neighbour to reorder columns.
  const moveStage = (index: number, dir: -1 | 1) => {
    const a = normalStages[index];
    const b = normalStages[index + dir];
    if (!a || !b) return;
    updateStage.mutate({ id: a.id, sort_order: b.sort_order });
    updateStage.mutate({ id: b.id, sort_order: a.sort_order });
  };

  // Enter in the search box goes to the first match and flashes it. Worked out
  // from what's typed right now, not the (slightly later) deferred search.
  const jumpToFirst = () => {
    const now = searchWords(query);
    if (now.length === 0) return;
    const first = [...hitsIn(now).values()].find((list) => list.length > 0)?.[0];
    if (!first) return;
    // Clear first so a second Enter on the same card flashes it again.
    setPulseId(null);
    window.requestAnimationFrame(() => {
      setPulseId(first.id);
      document
        .getElementById(`card-${first.id}`)
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
  };

  // Only when there's nothing to show: a failed background refresh keeps the
  // board that's already on screen.
  const noData = stagesQuery.data === undefined || jobsQuery.data === undefined;
  if (noData && (stagesQuery.isError || jobsQuery.isError)) {
    return (
      <ErrorState
        title="Couldn't load your jobs"
        onRetry={() => {
          stagesQuery.refetch();
          jobsQuery.refetch();
        }}
      >
        The server didn&apos;t answer. Your jobs are safe.
      </ErrorState>
    );
  }
  if (noData) return <BoardSkeleton />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchBox}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToFirst();
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search jobs or companies"
            aria-label="Search the board"
            className="h-9 pl-8 pr-9"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchBox.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-xs text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>
        {hits && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {matchCount === 0
              ? "No jobs match"
              : `${matchCount} ${matchCount === 1 ? "match" : "matches"} · Enter to jump`}
          </p>
        )}
        <div className="ml-auto">
          <AddStageDialog />
        </div>
      </div>

      {savedJobs.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title="No saved jobs yet"
          action={
            <Button asChild size="sm">
              <Link to="/search">Find jobs</Link>
            </Button>
          }
        >
          Save a job and it shows up here, where you can move it from Applied to Offer.
        </EmptyState>
      )}

      <div className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto pb-2 sm:snap-none">
        <DndContext
          sensors={sensors}
          collisionDetection={underPointer}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveJob(null)}
        >
          <ResearchColumn jobs={researchJobs} />

          {normalStages.map((stage: PipelineStage, i) => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              jobs={columns.get(stage.id) ?? []}
              stages={normalStages}
              followUpDays={followUpDays}
              words={words}
              hits={hits?.get(stage.id) ?? null}
              pulseId={pulseId}
              onMoveJob={move}
              canMoveLeft={i > 0}
              canMoveRight={i < normalStages.length - 1}
              onMove={(dir) => moveStage(i, dir)}
            />
          ))}

          <DragOverlay>
            {activeJob && (
              <CardFace
                savedJob={activeJob}
                followUpDays={followUpDays}
                className="rotate-2 cursor-grabbing shadow-xl"
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
