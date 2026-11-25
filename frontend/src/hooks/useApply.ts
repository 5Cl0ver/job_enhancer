/**
 * TanStack Query hooks for Apply with Claude (spec 022): start a run, watch it
 * live, answer, keep going, decide, stop; the things told to Claude; and the
 * master / made-for-a-job résumés.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { type ApplyRun, type ApplyRunShort, isOpenApply } from "@/lib/apply";

const LIVE_MS = 3000;
const BANNER_MS = 15_000;

/** One run; re-read every 3 s while it's open. */
export function useApplyRun(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery<ApplyRun>({
    queryKey: ["apply-run", id],
    queryFn: async () => {
      const run = await api.get<ApplyRun>(`/v1/apply/runs/${id}`);
      const was = qc.getQueryData<ApplyRun>(["apply-run", id]);
      // A résumé was saved, or the job moved to Applied: those pages are stale.
      if (was && (was.resume_id !== run.resume_id || was.status !== run.status)) {
        qc.invalidateQueries({ queryKey: ["saved-jobs"] });
        qc.invalidateQueries({ queryKey: ["resumes"] });
        qc.invalidateQueries({ queryKey: ["documents"] });
        qc.invalidateQueries({ queryKey: ["apply-open"] });
        qc.invalidateQueries({ queryKey: ["apply-runs"] });
      }
      return run;
    },
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isOpenApply(q.state.data) ? LIVE_MS : false),
  });
}

/** The open run (for the top banner), checked every 15 s while there is one. */
export function useOpenApply() {
  return useQuery<ApplyRunShort | null>({
    queryKey: ["apply-open"],
    queryFn: () => api.get<ApplyRunShort | null>("/v1/apply/runs/open"),
    // 15 s while one is open; a slow minute otherwise, so a run started on the
    // computer reaches the phone's banner too.
    refetchInterval: (q) => (q.state.data ? BANNER_MS : 60_000),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

/** A job's runs, newest first (What you sent, and the button's state). */
export function useJobApplyRuns(savedJobId: string | undefined) {
  return useQuery<ApplyRunShort[]>({
    queryKey: ["apply-runs", savedJobId],
    queryFn: () => api.get<ApplyRunShort[]>(`/v1/apply/runs?saved_job_id=${savedJobId}`),
    enabled: !!savedJobId,
  });
}

export class BusyError extends Error {
  constructor(public openRunId: string | null) {
    super("Another application is already going.");
  }
}

export function useStartApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (savedJobId: string) => {
      try {
        return await api.post<ApplyRun>("/v1/apply/runs", { saved_job_id: savedJobId });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const open = await api.get<ApplyRunShort | null>("/v1/apply/runs/open").catch(() => null);
          throw new BusyError(open?.id ?? null);
        }
        throw err;
      }
    },
    onSuccess: (run) => {
      qc.setQueryData(["apply-run", run.id], run);
      qc.invalidateQueries({ queryKey: ["apply-open"] });
      qc.invalidateQueries({ queryKey: ["apply-runs"] });
    },
  });
}

function useRunAction<T>(path: (vars: T) => string, body: (vars: T) => unknown = () => ({})) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: T) => api.post<ApplyRun>(path(vars), body(vars)),
    // A poll already on its way must not write the old run back over this one.
    onMutate: () => qc.cancelQueries({ queryKey: ["apply-run"] }),
    onSuccess: (run) => {
      qc.setQueryData(["apply-run", run.id], run);
      qc.invalidateQueries({ queryKey: ["apply-open"] });
      qc.invalidateQueries({ queryKey: ["apply-runs"] });
      if (run.status === "sent") qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}

export const useAnswerQuestions = () =>
  useRunAction<{ runId: string; answers: { id: string; answer?: string; skipped?: boolean }[]; done: boolean }>(
    (v) => `/v1/apply/runs/${v.runId}/answers`,
    (v) => ({ answers: v.answers, done: v.done }),
  );

/** Keep going, with the user's answer when Claude asked (spec 023). */
export const useHelpDone = () =>
  useRunAction<{ runId: string; reply?: string }>(
    (v) => `/v1/apply/runs/${v.runId}/help-done`,
    (v) => ({ reply: v.reply ?? null }),
  );

/** Write to Claude: it gets it on its next connector call. */
export const usePostMessage = () =>
  useRunAction<{ runId: string; text: string }>(
    (v) => `/v1/apply/runs/${v.runId}/messages`,
    (v) => ({ text: v.text }),
  );

/** "It wasn't sent": back to the review. */
export const useNotSent = () => useRunAction<string>((id) => `/v1/apply/runs/${id}/not-sent`);

/** A photo of the application's screen as it is now. */
export function usePeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post<{ request_id: string }>(`/v1/apply/runs/${runId}/peek`, {}),
    onSuccess: (_r, runId) => qc.invalidateQueries({ queryKey: ["apply-run", runId] }),
  });
}

export const useDecide = () =>
  useRunAction<{ runId: string; decision: "submit" | "fix" | "self"; note?: string }>(
    (v) => `/v1/apply/runs/${v.runId}/decision`,
    (v) => ({ decision: v.decision, note: v.note }),
  );

export const useMarkSent = () => useRunAction<string>((id) => `/v1/apply/runs/${id}/sent`);

export const useStopApply = () => useRunAction<string>((id) => `/v1/apply/runs/${id}/stop`);

// --- Things told to Claude --------------------------------------------------

export interface Fact {
  id: string;
  question: string;
  answer: string;
  saved_job_id: string | null;
}

export function useFacts() {
  return useQuery<Fact[]>({ queryKey: ["profile-facts"], queryFn: () => api.get<Fact[]>("/v1/profile-facts") });
}

export function useEditFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; answer: string }) => api.patch<Fact>(`/v1/profile-facts/${v.id}`, { answer: v.answer }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-facts"] }),
  });
}

export function useDeleteFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/profile-facts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-facts"] }),
  });
}

// --- Master and made-for-a-job résumés ----------------------------------------

export function useSetMasterResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.put(`/v1/ai/resumes/${id}/master`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resumes"] }),
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/ai/resumes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}

/** A photo of an application page, fetched with the sign-in token, as a URL
 * that lives only while it's on screen (freed after, so a phone's memory isn't
 * filled by a long application's photos). */
export function usePhoto(id: string) {
  const { data: blob, isError } = useQuery<Blob>({
    queryKey: ["apply-photo", id],
    queryFn: () => api.getBlob(`/v1/apply/photos/${id}`),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return { data: src, isError };
}
