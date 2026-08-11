/**
 * TanStack Query hooks for the learn-as-you-go answer memory.
 * These power the "Saved Answers" manager in Settings, where the user can fix
 * a typo the extension learned or delete anything wrong.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CustomAnswer {
  question_key: string;
  question_text: string;
  answer: string;
  updated_at?: string | null;
}

export function useCustomAnswers() {
  return useQuery<CustomAnswer[]>({
    queryKey: ["custom-answers"],
    queryFn: () => api.get<CustomAnswer[]>("/v1/users/me/custom-answers"),
    staleTime: 60_000,
  });
}

/** Upsert one answer (edit its text) — reuses the bulk PUT with a single item. */
export function useSaveCustomAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: CustomAnswer) =>
      api.put<CustomAnswer[]>("/v1/users/me/custom-answers", { answers: [a] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-answers"] }),
  });
}

export function useDeleteCustomAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionKey: string) =>
      api.delete(`/v1/users/me/custom-answers/${encodeURIComponent(questionKey)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-answers"] }),
  });
}
