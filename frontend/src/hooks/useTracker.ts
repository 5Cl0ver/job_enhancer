/**
 * TanStack Query hooks for the Kanban pipeline tracker.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PipelineStage, SavedJob } from "@/types/api";
import { useSavedJobs } from "@/hooks/useSavedJobs";

export function usePipelineStages() {
  return useQuery<PipelineStage[]>({
    queryKey: ["pipeline-stages"],
    queryFn: () => api.get<PipelineStage[]>("/api/v1/pipeline-stages/"),
    staleTime: 5 * 60_000,
  });
}

export function useKanbanJobs() {
  return useSavedJobs({ isArchived: false });
}

export function useMoveJobStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, stageId }: { savedJobId: string; stageId: string | null }) =>
      api.post<SavedJob>("/api/v1/pipeline-stages/move", {
        saved_job_id: savedJobId,
        stage_id: stageId,
      }),
    onMutate: async ({ savedJobId, stageId }) => {
      await qc.cancelQueries({ queryKey: ["saved-jobs"] });
      const prev = qc.getQueryData<SavedJob[]>(["saved-jobs", undefined]);
      if (prev) {
        qc.setQueryData<SavedJob[]>(
          ["saved-jobs", undefined],
          prev.map((sj) =>
            sj.id === savedJobId ? { ...sj, pipeline_stage_id: stageId } : sj,
          ),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["saved-jobs", undefined], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}

export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      api.post<PipelineStage>("/api/v1/pipeline-stages/", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages"] }),
  });
}

export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/pipeline-stages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-stages"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}
