import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMoveJobStage, usePipelineStages } from "@/hooks/useTracker";
import { stageTone } from "@/lib/stageStyle";
import { cn } from "@/lib/utils";
import type { SavedJob } from "@/types/api";

/**
 * A saved job's stage as a coloured pill you can change: the same move as
 * dragging its card on the board, from anywhere the job is shown (its own
 * page, on a phone).
 */
export function StagePicker({ savedJob, className }: { savedJob: SavedJob; className?: string }) {
  const { data: stages = [] } = usePipelineStages();
  const moveJob = useMoveJobStage();
  const current = stages.find((s) => s.id === savedJob.pipeline_stage_id);
  const tone = stageTone(current?.name);

  const move = (stageId: string) => {
    moveJob.mutateAsync({ savedJobId: savedJob.id, stageId }).catch(() =>
      toast.error("Couldn't move that job. It's back where it was.", {
        action: { label: "Retry", onClick: () => move(stageId) },
      }),
    );
  };

  return (
    <Select value={savedJob.pipeline_stage_id ?? ""} onValueChange={move}>
      <SelectTrigger
        aria-label="Stage"
        className={cn(
          "h-9 w-auto gap-2 rounded-full border-transparent px-3.5 font-medium shadow-none",
          tone.chip,
          className,
        )}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
        <SelectValue placeholder="No stage yet" />
      </SelectTrigger>
      <SelectContent>
        {stages.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
