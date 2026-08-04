import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
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
import { usePipelineStages, useKanbanJobs, useMoveJobStage, useCreateStage } from "@/hooks/useTracker";
import type { SavedJob } from "@/types/api";

const DEFAULT_FOLLOW_UP_DAYS = 7;

function AddStageDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createStage = useCreateStage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createStage.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
        },
      },
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

export function KanbanBoard() {
  const { data: stages = [] } = usePipelineStages();
  const { data: savedJobs = [] } = useKanbanJobs();
  const moveJob = useMoveJobStage();
  const [activeJob, setActiveJob] = useState<SavedJob | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const job = savedJobs.find((sj) => sj.id === event.active.id);
    setActiveJob(job ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveJob(null);
    if (!over || active.id === over.id) return;

    // `over.id` is a column (stage) id — move job to that stage
    const targetStageId = stages.find((s) => s.id === over.id)?.id ?? null;
    if (targetStageId !== undefined) {
      moveJob.mutate({ savedJobId: String(active.id), stageId: targetStageId });
    }
  };

  const jobsByStage = (stageId: string) =>
    savedJobs.filter((sj) => sj.pipeline_stage_id === stageId);

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
          {stages.map((stage) => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              jobs={jobsByStage(stage.id)}
              followUpDays={DEFAULT_FOLLOW_UP_DAYS}
            />
          ))}

          <DragOverlay>
            {activeJob && (
              <KanbanCard savedJob={activeJob} followUpDays={DEFAULT_FOLLOW_UP_DAYS} />
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
