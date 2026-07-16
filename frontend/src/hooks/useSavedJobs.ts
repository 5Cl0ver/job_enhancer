/**
 * TanStack Query hooks for saved jobs and collections.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SavedJob, Collection } from "@/types/api";

// -------------------------
// Collections
// -------------------------

export function useCollections() {
  return useQuery<Collection[]>({
    queryKey: ["collections"],
    queryFn: () => api.get<Collection[]>("/v1/collections/"),
    staleTime: 5 * 60_000,
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      api.post<Collection>("/v1/collections/", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/collections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}

// -------------------------
// Saved jobs
// -------------------------

export function useSavedJobs(params?: {
  collectionId?: string;
  pipelineStageId?: string;
  isArchived?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.collectionId) qs.set("collection_id", params.collectionId);
  if (params?.pipelineStageId) qs.set("pipeline_stage_id", params.pipelineStageId);
  if (params?.isArchived) qs.set("is_archived", "true");

  return useQuery<SavedJob[]>({
    queryKey: ["saved-jobs", params],
    queryFn: () => api.get<SavedJob[]>(`/v1/saved-jobs/?${qs.toString()}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Check if a specific job listing is saved — returns the saved_job.id if so. */
export function useSavedJobId(jobListingId: string) {
  const { data, isLoading } = useSavedJobs();
  const match = data?.find((sj) => sj.job_listing_id === jobListingId);
  return { savedJobId: match?.id ?? null, isLoading };
}

export function useSaveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { job_listing_id: string; collection_id?: string; notes?: string }) =>
      api.post<SavedJob>("/v1/saved-jobs/", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-jobs"] }),
  });
}

export function useUpdateSavedJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      collection_id?: string | null;
      pipeline_stage_id?: string | null;
      notes?: string | null;
      is_archived?: boolean;
    }) => api.patch<SavedJob>(`/v1/saved-jobs/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}

export function useUnsaveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/saved-jobs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-jobs"] }),
  });
}
