/**
 * Cover letters (spec 031): the user's letters, and the one that goes with a
 * job. Claude writes them through the connector, or the user writes or pastes
 * their own (spec 040); the app shows, edits and picks them.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CoverLetterItem {
  id: string;
  /** The job it was written for, if any. */
  job_listing_id: string | null;
  job_title: string;
  company: string;
  created_at: string;
}

export function useCoverLetters() {
  return useQuery<CoverLetterItem[]>({
    queryKey: ["cover-letters"],
    queryFn: () => api.get<CoverLetterItem[]>("/v1/ai/cover-letters"),
    staleTime: 60_000,
  });
}

/** The cover letter for one saved job; null = none. */
export function useSetJobCoverLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, coverLetterId }: { savedJobId: string; coverLetterId: string | null }) =>
      api.put(`/v1/saved-jobs/${encodeURIComponent(savedJobId)}/cover-letter`, {
        cover_letter_id: coverLetterId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["apply-run"] });
    },
  });
}

/** The user's own letter for one saved job (spec 040): it becomes the job's. */
export function useWriteJobCoverLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, text }: { savedJobId: string; text: string }) =>
      api.post<{ id: string }>(`/v1/saved-jobs/${encodeURIComponent(savedJobId)}/cover-letter/write`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cover-letters"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["apply-run"] });
    },
  });
}
