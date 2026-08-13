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
    queryFn: () => api.get<PipelineStage[]>("/v1/pipeline-stages/"),
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
      api.post<SavedJob>("/v1/pipeline-stages/move", {
        saved_job_id: savedJobId,
        stage_id: stageId,
      }),
    onMutate: async ({ savedJobId, stageId }) => {
      await qc.cancelQueries({ queryKey: ["saved-jobs"] });
      // Update EVERY saved-jobs cache (the board's key includes filter params),
      // so the card moves the instant you drop it.
      const prev = qc.getQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] });
      qc.setQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] }, (old) =>
        old
          ? old.map((sj) =>
              sj.id === savedJobId ? { ...sj, pipeline_stage_id: stageId } : sj,
            )
          : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}

/** Toggle the "Contact Further" research flag — lives alongside the stage. */
export function useToggleResearchFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, flagged }: { savedJobId: string; flagged: boolean }) =>
      api.patch<SavedJob>(`/v1/saved-jobs/${savedJobId}`, { flagged_for_research: flagged }),
    onMutate: async ({ savedJobId, flagged }) => {
      await qc.cancelQueries({ queryKey: ["saved-jobs"] });
      // Flip it in EVERY saved-jobs cache so the card + Contact Further column
      // react the instant you click (the board's key includes filter params).
      const prev = qc.getQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] });
      qc.setQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] }, (old) =>
        old
          ? old.map((sj) =>
              sj.id === savedJobId ? { ...sj, flagged_for_research: flagged } : sj,
            )
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["saved-jobs"] }),
  });
}

/**
 * Mark a job as emailed (or clear it). Pass an ISO timestamp to record the
 * send, or null to un-mark. Optimistic so the ✉️ badge flips instantly.
 */
export function useToggleEmailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, emailedAt }: { savedJobId: string; emailedAt: string | null }) =>
      api.patch<SavedJob>(`/v1/saved-jobs/${savedJobId}`, { emailed_at: emailedAt }),
    onMutate: async ({ savedJobId, emailedAt }) => {
      await qc.cancelQueries({ queryKey: ["saved-jobs"] });
      const prev = qc.getQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] });
      qc.setQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] }, (old) =>
        old
          ? old.map((sj) =>
              sj.id === savedJobId ? { ...sj, emailed_at: emailedAt } : sj,
            )
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["saved-jobs"] }),
  });
}

/** Reorder a stage column by patching its sort_order (used by the ◀ ▶ buttons). */
export function useUpdateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sort_order }: { id: string; sort_order: number }) =>
      api.patch<PipelineStage>(`/v1/pipeline-stages/${id}`, { sort_order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages"] }),
  });
}

export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      api.post<PipelineStage>("/v1/pipeline-stages/", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages"] }),
  });
}

export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/pipeline-stages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-stages"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}
