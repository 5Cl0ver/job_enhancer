/**
 * TanStack Query hooks for onboarding (spec 019 part B): how far the Welcome
 * got, and the Getting started checklist. The ticks come from the server, which
 * works them out from what the person actually has.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ChecklistKey = "resume" | "profile" | "job_catcher" | "first_job" | "email" | "claude";

export interface Onboarding {
  welcome: { step: number; done: boolean };
  checklist_hidden: boolean;
  items: { key: ChecklistKey; done: boolean; required: boolean }[];
  required_done: number;
  required_total: number;
}

export interface OnboardingChange {
  welcome_step?: number;
  welcome_done?: boolean;
  profile_reviewed?: boolean;
  checklist_hidden?: boolean;
}

const KEY = ["onboarding"];

/** `pollMs`: keep checking (the Welcome's Job Catcher step waits for Connect). */
export function useOnboarding(pollMs?: number) {
  return useQuery<Onboarding>({
    queryKey: KEY,
    queryFn: () => api.get<Onboarding>("/v1/onboarding"),
    staleTime: 30_000,
    refetchInterval: pollMs,
  });
}

export function useUpdateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: OnboardingChange) => api.patch<Onboarding>("/v1/onboarding", change),
    onSuccess: (state) => qc.setQueryData(KEY, state),
  });
}
