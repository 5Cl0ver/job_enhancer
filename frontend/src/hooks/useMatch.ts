/**
 * Resume ↔ job match score (keyword coverage) for one job listing.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MatchResponse {
  has_resume: boolean;
  has_description: boolean;
  /** 0-100; meaningful only when both flags above are true. */
  score: number;
  matched: string[];
  missing: string[];
}

export function useMatch(jobId: string | undefined) {
  return useQuery<MatchResponse>({
    queryKey: ["match", jobId],
    queryFn: () => api.get<MatchResponse>(`/v1/jobs/${jobId}/match`),
    enabled: !!jobId,
    staleTime: 5 * 60_000, // recomputes on resume upload via invalidation
  });
}
