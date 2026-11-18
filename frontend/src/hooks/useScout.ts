/**
 * TanStack Query hooks for Claude Scout: resume types (tracks).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Track, TrackInput } from "@/lib/scout";

export function useTracks() {
  return useQuery<Track[]>({
    queryKey: ["scout-tracks"],
    queryFn: () => api.get<Track[]>("/v1/scout/tracks"),
  });
}

export function useCreateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TrackInput) => api.post<Track>("/v1/scout/tracks", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-tracks"] }),
  });
}

export function useUpdateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<TrackInput> & { id: string }) =>
      api.patch<Track>(`/v1/scout/tracks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-tracks"] }),
  });
}

export function useDeleteTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/scout/tracks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scout-tracks"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}

/** Upload a resume for one resume type without replacing the main resume
 * (the one match scores and autofill use). */
export function useUploadTrackResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<{ id: string; filename: string }>(
        "/v1/ai/resumes?make_active=false",
        form,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resumes"] }),
  });
}
