/**
 * Tie an email to the saved job it's really about (spec 013): "Same job as…"
 * on a job made from an email, and "It's one of my jobs" on an email update
 * the scan couldn't place. Both come with the user's saved jobs ranked,
 * likeliest first.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DetectedEvent } from "@/hooks/useEmailAccount";

export interface JobOption {
  saved_job_id: string;
  title: string;
  company: string;
  location: string | null;
  stage: string | null;
  /** The emails point at this job. */
  likely: boolean;
}

export interface LinkUndo {
  target_id: string;
  events: { id: string; previous_stage_id: string | null }[];
  previous_stage_id: string | null;
  stage_moved: boolean;
  previous_applied_at: string | null;
}

export interface LinkResult {
  saved_job_id: string;
  job_listing_id: string;
  stage: string | null;
  undo: LinkUndo;
}

/** Where a picker's choices come from: a job made from an email, or an update. */
export type LinkSource = { job: string } | { event: string };

const optionsPath = (src: LinkSource) =>
  "job" in src
    ? `/v1/saved-jobs/${src.job}/link-options`
    : `/v1/email/events/${src.event}/link-options`;

/** The user's saved jobs, likeliest first; loaded only while the picker is open. */
export function useLinkOptions(src: LinkSource, enabled: boolean) {
  return useQuery({
    queryKey: ["link-options", src],
    queryFn: () => api.get<JobOption[]>(optionsPath(src)),
    enabled,
    staleTime: 30_000,
  });
}

function refresh(qc: ReturnType<typeof useQueryClient>) {
  for (const queryKey of [
    ["saved-jobs"],
    ["tracker"],
    ["jobs"],
    ["job-source"],
    ["job-emails"],
    ["email-events"],
    ["link-options"],
  ])
    qc.invalidateQueries({ queryKey });
}

/** "Same job as…": fold a job made from an email into the real one. */
export function useLinkJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) =>
      api.post<LinkResult>(`/v1/saved-jobs/${id}/link`, { target_id: targetId }),
    onSettled: () => refresh(qc),
  });
}

/** Undo "Same job as…": the copy comes back with its emails. */
export function useUnlinkJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, undo }: { id: string; undo: LinkUndo }) =>
      api.post<null>(`/v1/saved-jobs/${id}/unlink`, undo),
    onSettled: () => refresh(qc),
  });
}

/** "It's one of my jobs": put an update on a saved job and move its card.
 * Repeats of the same update are cleared in the same step. */
export function useLinkEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      repeats,
      savedJobId,
    }: {
      lead: DetectedEvent;
      repeats: DetectedEvent[];
      savedJobId: string;
    }) => {
      const done = await api.post<DetectedEvent>(`/v1/email/events/${lead.id}/link`, {
        saved_job_id: savedJobId,
      });
      for (const r of repeats) {
        await api.post<DetectedEvent>(`/v1/email/events/${r.id}/dismiss`, {});
      }
      return done;
    },
    onSettled: () => refresh(qc),
  });
}
