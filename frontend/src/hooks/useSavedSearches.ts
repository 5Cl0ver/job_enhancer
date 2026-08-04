import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NewMatchesResponse, SavedSearch } from "@/types/api";

export function useSavedSearches() {
  return useQuery<SavedSearch[]>({
    queryKey: ["saved-searches"],
    queryFn: () => api.get<SavedSearch[]>("/v1/saved-searches/"),
    staleTime: 60_000,
  });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      q: string;
      location?: string;
      remote_only?: boolean;
      salary_min?: number;
      salary_max?: number;
      experience?: string;
      job_type?: string;
      name?: string;
    }) => api.post<SavedSearch>("/v1/saved-searches/", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      qc.invalidateQueries({ queryKey: ["new-matches"] });
    },
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/saved-searches/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      qc.invalidateQueries({ queryKey: ["new-matches"] });
    },
  });
}

/** The "New matches" feed — jobs found since each search was last viewed. */
export function useNewMatches() {
  return useQuery<NewMatchesResponse>({
    queryKey: ["new-matches"],
    queryFn: () => api.get<NewMatchesResponse>("/v1/saved-searches/matches"),
    staleTime: 60_000,
  });
}

export function useMarkMatchesSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/v1/saved-searches/mark-seen", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["new-matches"] }),
  });
}
