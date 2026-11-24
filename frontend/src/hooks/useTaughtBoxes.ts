/**
 * TanStack Query hooks for the boxes the user taught Job Catcher with
 * "Point at a box" (spec 017/018): a box on one site, remembered with the
 * profile answer or the text that goes in it. Powers "Boxes you taught" on
 * the Autofill memory page, where each can be changed or removed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface TaughtBox {
  id: string;
  site: string;
  /** The box's question, as Job Catcher read it. */
  label: string;
  profile_key: string | null;
  answer: string | null;
  created_at?: string | null;
}

export function useTaughtBoxes() {
  return useQuery<TaughtBox[]>({
    queryKey: ["taught-boxes"],
    queryFn: () => api.get<TaughtBox[]>("/v1/autofill/taught"),
    staleTime: 60_000,
  });
}

/** Change what a taught box gets: a typed answer (or a profile answer's key). */
export function useEditTaughtBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; answer?: string; profile_key?: string }) =>
      api.patch(`/v1/autofill/taught/${encodeURIComponent(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taught-boxes"] }),
  });
}

export function useForgetTaughtBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/autofill/taught/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taught-boxes"] }),
  });
}
