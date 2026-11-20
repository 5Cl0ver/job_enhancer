import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Attention {
  tasks_open: number;
  tasks_overdue: number;
  /** Email updates waiting for a click or an answer. */
  email_review: number;
}

/** Counts for the navigation badges. Cheap (three numbers), refreshed every
 * minute. The key sits under "email-events" so every email action, which
 * already refreshes that list, refreshes the count with it. */
export function useAttention() {
  return useQuery<Attention>({
    queryKey: ["email-events", "attention"],
    queryFn: () => api.get<Attention>("/v1/attention"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
