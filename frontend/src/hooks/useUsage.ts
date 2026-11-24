/**
 * What's left of today's free allowances (spec 019 part C): live searches now,
 * and the AI kinds once AI is back. Each kind says whether it's in use (`on`).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AllowanceKind = "ai_document" | "ai_read" | "ai_autofill" | "live_search";

export interface Usage {
  exempt: boolean;
  resets_at: string;
  kinds: Record<AllowanceKind, { used: number; limit: number; left: number; on: boolean }>;
  shared: { jsearch_month: { used: number; cap: number; reserve: number } };
}

export const USAGE_KEY = ["usage"];

export function useUsage() {
  return useQuery<Usage>({
    queryKey: USAGE_KEY,
    queryFn: () => api.get<Usage>("/v1/usage"),
    staleTime: 60_000,
  });
}
