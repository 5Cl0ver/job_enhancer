/**
 * TanStack Query hooks for Apply with Claude (spec 022): start a run, watch it
 * live, answer, keep going, decide, stop; the things told to Claude; and the
 * master / made-for-a-job résumés.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { type ApplyMode, type ApplyRun, type ApplyRunShort, type Fix, isOpenApply } from "@/lib/apply";

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
      // Claude wrote a cover letter (spec 031): the job's pickers show it.
      if (was && was.cover_letter?.id !== run.cover_letter?.id) {
        qc.invalidateQueries({ queryKey: ["cover-letters"] });
        qc.invalidateQueries({ queryKey: ["saved-jobs"] });
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
  /** The open run's job and step (spec 036), so the dialog can say which
   * one, and never offers to stop one waiting for "Did it go through?". */
  constructor(
    public openRunId: string | null,
    public title = "",
    public company = "",
    public status = "",
  ) {
    super("Another application is already going.");
  }
}

export function useStartApply() {
  const qc = useQueryClient();
  return useMutation({
    /** resumeId: a résumé the user picked, so Claude doesn't write one (spec 025). */
    mutationFn: async ({ savedJobId, resumeId }: { savedJobId: string; resumeId?: string | null }) => {
      try {
        return await api.post<ApplyRun>("/v1/apply/runs", { saved_job_id: savedJobId, resume_id: resumeId ?? null });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const open = await api.get<ApplyRunShort | null>("/v1/apply/runs/open").catch(() => null);
          throw new BusyError(open?.id ?? null, open?.job?.title ?? "", open?.job?.company ?? "", open?.status ?? "");
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
  useRunAction<{
    runId: string;
    answers: { id: string; answer?: string; skipped?: boolean; guessed?: boolean }[];
    done: boolean;
  }>(
    (v) => `/v1/apply/runs/${v.runId}/answers`,
    (v) => ({ answers: v.answers, done: v.done }),
  );

/** Keep going, with the user's answer when Claude asked (spec 023). */
export const useHelpDone = () =>
  useRunAction<{ runId: string; reply?: string }>(
    (v) => `/v1/apply/runs/${v.runId}/help-done`,
    (v) => ({ reply: v.reply ?? null }),
  );

/** A run changed by any verb (PATCH, DELETE…): it becomes the run on screen. */
function useRunChange<T>(send: (vars: T) => Promise<ApplyRun>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: () => qc.cancelQueries({ queryKey: ["apply-run"] }),
    onSuccess: (run) => {
      qc.setQueryData(["apply-run", run.id], run);
      qc.invalidateQueries({ queryKey: ["apply-open"] });
    },
  });
}

const fixBody = (v: { to?: string; ask?: string }) => ({ to: v.to || null, ask: v.ask || null });

/** Change a box on any step, or ask Claude about it: it waits on the run
 * until a checkpoint, never interrupting Claude (spec 033). */
export const useAddFix = () =>
  useRunAction<{ runId: string; step: string; q: string; k: number; to?: string; ask?: string }>(
    (v) => `/v1/apply/runs/${v.runId}/fixes`,
    (v) => ({ step: v.step, q: v.q, k: v.k, ...fixBody(v) }),
  );

export const useEditFix = () =>
  useRunChange((v: { runId: string; fixId: string; to?: string; ask?: string }) =>
    api.patch<ApplyRun>(`/v1/apply/runs/${v.runId}/fixes/${v.fixId}`, fixBody(v)),
  );

export const useRemoveFix = () =>
  useRunChange((v: { runId: string; fixId: string }) =>
    api.delete<ApplyRun>(`/v1/apply/runs/${v.runId}/fixes/${v.fixId}`),
  );

/** Send now (or the review's Send fixes): every waiting fix goes to Claude. */
export const useSendFixes = () => useRunAction<string>((id) => `/v1/apply/runs/${id}/fixes/send`);

/** Page by page: the owner looked the step over; its fixes go with it. */
export const useContinue = () => useRunAction<string>((id) => `/v1/apply/runs/${id}/continue`);

/** Page by page or Keep going, any time. */
export const useSetMode = () =>
  useRunChange((v: { runId: string; mode: ApplyMode }) =>
    api.patch<ApplyRun>(`/v1/apply/runs/${v.runId}/mode`, { mode: v.mode }),
  );

/** Write to Claude: it gets it on its next connector call. */
export const usePostMessage = () =>
  useRunAction<{ runId: string; text: string }>(
    (v) => `/v1/apply/runs/${v.runId}/messages`,
    (v) => ({ text: v.text }),
  );

/** The user's look at Claude's résumé: use it, or change it (spec 025). */
export const useResumeDecision = () =>
  useRunAction<{ runId: string; decision: "use" | "change"; note?: string }>(
    (v) => `/v1/apply/runs/${v.runId}/resume-decision`,
    (v) => ({ decision: v.decision, note: v.note ?? null }),
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
  useRunAction<{ runId: string; decision: "submit" | "fix" | "self"; note?: string; fixes?: Fix[] }>(
    (v) => `/v1/apply/runs/${v.runId}/decision`,
    (v) => ({ decision: v.decision, note: v.note, ...(v.fixes?.length ? { fixes: v.fixes } : {}) }),
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
