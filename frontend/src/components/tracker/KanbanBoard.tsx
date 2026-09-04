import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from "@dnd-kit/core";
import { Plus, Search, MailCheck } from "lucide-react";
import { format } from "date-fns";
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
import { PipelineColumn } from "@/components/tracker/PipelineColumn";
import { KanbanCard } from "@/components/tracker/KanbanCard";
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
import { cn } from "@/lib/utils";
import type { PipelineStage, SavedJob } from "@/types/api";

const DEFAULT_FOLLOW_UP_DAYS = 7;
const RESEARCH_DROP_ID = "research-flag";
// A stage the user may have created by hand before this became a built-in flag.
const CONTACT_FURTHER = /^contact\s*further$/i;

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
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5">
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
    <div className="flex w-64 shrink-0 flex-col gap-2">
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
        ref={setNodeRef}
        className={cn(
          "flex min-h-[120px] flex-col gap-2 rounded-b-lg border border-t-0 border-amber-200 bg-amber-50/40 p-2 transition-colors dark:border-amber-900 dark:bg-amber-950/20",
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

export function KanbanBoard() {
  const { data: stages = [] } = usePipelineStages();
  const { data: savedJobs = [] } = useKanbanJobs();
  const { data: profile } = useProfile();
  // Use the user's real follow-up cadence (Settings), not a hardcoded 7 days.
  const followUpDays = profile?.follow_up_days ?? DEFAULT_FOLLOW_UP_DAYS;
  const moveJob = useMoveJobStage();
  const toggleFlag = useToggleResearchFlag();
  const updateStage = useUpdateStage();
  const [activeJob, setActiveJob] = useState<SavedJob | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // A hand-made "Contact Further" stage is now superseded by the built-in flag
  // column: hide it from the normal columns and fold its jobs into the flag.
  const normalStages = stages.filter((s) => !CONTACT_FURTHER.test(s.name));
  const cfStageIds = new Set(
    stages.filter((s) => CONTACT_FURTHER.test(s.name)).map((s) => s.id),
  );
  const researchJobs = savedJobs.filter(
    (sj) =>
      sj.flagged_for_research ||
      (sj.pipeline_stage_id != null && cfStageIds.has(sj.pipeline_stage_id)),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJob(savedJobs.find((sj) => sj.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveJob(null);
    if (!over) return;
    if (over.id === RESEARCH_DROP_ID) {
      // Dropping onto Contact Further FLAGS the job (keeps its real stage).
      toggleFlag.mutate({ savedJobId: String(active.id), flagged: true });
      return;
    }
    if (active.id === over.id) return;
    const targetStageId = normalStages.find((s) => s.id === over.id)?.id ?? null;
    if (targetStageId) {
      moveJob.mutate({ savedJobId: String(active.id), stageId: targetStageId });
    }
  };

  const jobsByStage = (stageId: string) =>
    savedJobs.filter((sj) => sj.pipeline_stage_id === stageId);

  // Swap this stage's sort_order with its neighbour to reorder columns.
  const moveStage = (index: number, dir: -1 | 1) => {
    const a = normalStages[index];
    const b = normalStages[index + dir];
    if (!a || !b) return;
    updateStage.mutate({ id: a.id, sort_order: b.sort_order });
    updateStage.mutate({ id: b.id, sort_order: a.sort_order });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Application Tracker</h1>
        <AddStageDialog />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <ResearchColumn jobs={researchJobs} />

          {normalStages.map((stage: PipelineStage, i) => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              jobs={jobsByStage(stage.id)}
              followUpDays={followUpDays}
              canMoveLeft={i > 0}
              canMoveRight={i < normalStages.length - 1}
              onMove={(dir) => moveStage(i, dir)}
            />
          ))}

          <DragOverlay>
            {activeJob && (
              <KanbanCard savedJob={activeJob} followUpDays={followUpDays} />
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
