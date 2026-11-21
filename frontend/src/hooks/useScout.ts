/**
 * TanStack Query hooks for Claude Scout: resume types (tracks), saved searches
 * (missions) and runs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  type Company,
  type FindingFilters,
  type FindingItem,
  type FindingPage,
  type InstructionKey,
  type Instructions,
  type InstructionSection,
  type InstructionVersion,
  isOpen,
  type Mission,
  type MissionInput,
  type Overrides,
  type Recommended,
  type Run,
  type RunEvent,
  type TitleTried,
  type Track,
  type TrackInput,
} from "@/lib/scout";

export function useTracks() {
  return useQuery<Track[]>({
    queryKey: ["scout-tracks"],
    queryFn: () => api.get<Track[]>("/v1/scout/tracks"),
  });
}

export function useCreateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TrackInput) => api.post<Track>("/v1/scout/tracks", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-tracks"] }),
  });
}

export function useUpdateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<TrackInput> & { id: string }) =>
      api.patch<Track>(`/v1/scout/tracks/${id}`, data),
    onSuccess: (_t, { id }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["scout-tracks"] }),
        // New titles, skills or rules start the type fresh.
        qc.invalidateQueries({ queryKey: ["scout-track-passes", id] }),
      ]),
  });
}

export function useDeleteTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/scout/tracks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scout-tracks"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
    },
  });
}

/** Upload a resume without replacing the main one (the one match scores and
 * autofill use). */
function uploadResume(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api.post<{ id: string; filename: string }>(
    "/v1/ai/resumes?make_active=false",
    form,
  );
}

/** The upload went through but linking it to the resume type didn't. */
export class AttachFailed extends Error {}

/** Upload a resume for one resume type (see `uploadResume`). */
export function useUploadTrackResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      return uploadResume(file);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["resumes"] }),
  });
}

/** The skills the app recognises in a resume, as the resume writes them. */
export function resumeSkills(resumeId: string): Promise<string[]> {
  return api
    .get<{ skills: string[] }>(`/v1/ai/resumes/${resumeId}/skills`)
    .then((r) => r.skills);
}

/**
 * Attach a resume file to a resume type in one go: upload it, link it, and, if
 * the type has no key skills yet, fill them in from the resume. Resolves with
 * how many skills were filled in.
 */
export function useAttachResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ track, file }: { track: Track; file: File }) => {
      const uploaded = await uploadResume(file);
      // Skills are a bonus: a failure here must not lose the upload.
      const skills =
        track.key_skills.length === 0
          ? await resumeSkills(uploaded.id).catch(() => [])
          : [];
      try {
        await api.patch<Track>(`/v1/scout/tracks/${track.id}`, {
          resume_id: uploaded.id,
          ...(skills.length > 0 ? { key_skills: skills } : {}),
        });
      } catch {
        // The file is in the user's resumes; say so rather than "upload failed".
        throw new AttachFailed(
          "The file uploaded, but it couldn't be attached. Open Edit and pick it from the list.",
        );
      }
      return skills.length;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      qc.invalidateQueries({ queryKey: ["scout-tracks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Searches (missions) and runs
// ---------------------------------------------------------------------------

/** The titles Claude passed over for one resume type. */
export function useTrackPasses(trackId: string) {
  return useQuery({
    queryKey: ["scout-track-passes", trackId],
    queryFn: () =>
      api.get<{
        count: number;
        titles: { title: string; times: number }[];
        since: string | null;
      }>(`/v1/scout/tracks/${trackId}/passes`),
  });
}

/** Weigh a resume type's passed-over titles and low-scored jobs again. */
export function useStartFresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) =>
      api.post(`/v1/scout/tracks/${trackId}/start-fresh`, {}),
    onSuccess: (_r, trackId) =>
      qc.invalidateQueries({ queryKey: ["scout-track-passes", trackId] }),
  });
}

export function useMissions() {
  return useQuery<Mission[]>({
    queryKey: ["scout-missions"],
    queryFn: () => api.get<Mission[]>("/v1/scout/missions"),
  });
}

export function useSaveMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: MissionInput & { id?: string }) =>
      id
        ? api.patch<Mission>(`/v1/scout/missions/${id}`, data)
        : api.post<Mission>("/v1/scout/missions", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-missions"] }),
  });
}

/** Change only a broad search's overrides (pin, block, the settings lists). */
export function useUpdateOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: Overrides }) =>
      api.patch<Mission>(`/v1/scout/missions/${id}`, { overrides }),
    // Wait for the fresh search, so the next tap builds on these overrides.
    onSuccess: (_m, { id }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["scout-missions"] }),
        qc.invalidateQueries({ queryKey: ["scout-titles", id] }),
      ]),
  });
}

/** The titles an "Anything I'd be good at" search has tried. */
export function useMissionTitles(missionId: string | null) {
  return useQuery({
    queryKey: ["scout-titles", missionId],
    queryFn: () =>
      api.get<TitleTried[]>(`/v1/scout/missions/${missionId}/titles`),
    enabled: !!missionId,
  });
}

export function useDeleteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/scout/missions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-missions"] }),
  });
}

/** Start = queue a run; Claude picks it up with the one fixed line. */
export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) =>
      api.post<Run>(`/v1/scout/missions/${missionId}/runs`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scout-runs"] });
      qc.invalidateQueries({ queryKey: ["scout-missions"] });
    },
  });
}

const POLL_MS = 5000;

/** Recent runs. Re-checks every 5 s only while one is waiting or running. */
export function useRuns() {
  return useQuery<Run[]>({
    queryKey: ["scout-runs"],
    queryFn: () => api.get<Run[]>("/v1/scout/runs"),
    refetchInterval: (q) => (q.state.data?.some(isOpen) ? POLL_MS : false),
  });
}

/** One run with what it found; live while it's open. */
export function useRun(id: string | null) {
  const qc = useQueryClient();
  return useQuery<Run>({
    queryKey: ["scout-run", id],
    queryFn: async () => {
      const run = await api.get<Run>(`/v1/scout/runs/${id}`);
      // A job was saved since the last look: My Jobs and its collections (the
      // run may have just made one) are out of date.
      const was = qc.getQueryData<Run>(["scout-run", id])?.counts;
      if (run.counts.saved !== (was?.saved ?? 0)) {
        qc.invalidateQueries({ queryKey: ["saved-jobs"] });
        qc.invalidateQueries({ queryKey: ["collections"] });
      }
      // A new good fit is waiting: the count on Find Jobs is out of date.
      if ((run.counts.picked ?? 0) !== (was?.picked ?? 0)) {
        qc.invalidateQueries({ queryKey: ["email-events", "attention"] });
      }
      return run;
    },
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data && isOpen(q.state.data) ? POLL_MS : false,
  });
}

export function useStopRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Run>(`/v1/scout/runs/${id}/stop`, {}),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ["scout-runs"] });
      qc.setQueryData(["scout-run", run.id], run);
    },
  });
}

// ---------------------------------------------------------------------------
// The review: the user ticks what to keep and where, then one button saves
// ---------------------------------------------------------------------------

export interface ConfirmResult {
  saved: { finding_id: string; saved_job_id: string | null }[];
  already: { finding_id: string; saved_job_id: string | null }[];
  failed: { finding_id: string; reason: string }[];
  folder: { id: string | null; name: string };
}

interface WhereBody {
  collection_id?: string;
  new_collection_name?: string;
}

/** Everything a save from Scout touches: the run, My Jobs, the collections
 * (one may have just been made) and the count on Find Jobs. */
function afterScoutSave(qc: ReturnType<typeof useQueryClient>) {
  for (const queryKey of [
    ["scout-run"],
    ["scout-runs"],
    ["scout-findings"],
    ["saved-jobs"],
    ["collections"],
    ["tracker"],
    ["email-events", "attention"],
  ]) {
    qc.invalidateQueries({ queryKey });
  }
}

/** Save the ticked findings of a run; picks left unticked are kept in History. */
export function useConfirmRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      ...body
    }: {
      runId: string;
      finding_ids: string[];
      shown_ids?: string[];
    } & WhereBody) =>
      api.post<ConfirmResult>(`/v1/scout/runs/${runId}/confirm`, body),
    onSuccess: () => afterScoutSave(qc),
  });
}

/** Save one finding later, from History. */
export function useSaveFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, ...body }: { findingId: string } & WhereBody) =>
      api.post<{
        finding_id: string;
        saved_job_id: string | null;
        already: boolean;
        folder: { id: string | null; name: string };
      }>(`/v1/scout/findings/${findingId}/save`, body),
    onSuccess: () => afterScoutSave(qc),
  });
}

// ---------------------------------------------------------------------------
// Results: every job Scout found, grouped against each run's bar
// ---------------------------------------------------------------------------

/** One page of findings for Results, best first (or newest). Live while a
 * run is open, so new jobs land without a refresh. */
export function useFindings(filters: FindingFilters, limit = 100) {
  const { data: runs } = useRuns();
  const params = new URLSearchParams({
    status: filters.status,
    sort: filters.sort,
    limit: String(limit),
  });
  if (filters.run) params.set("run", filters.run);
  if (filters.track) params.set("track", filters.track);
  return useQuery<FindingPage>({
    queryKey: ["scout-findings", filters, limit],
    queryFn: () => api.get<FindingPage>(`/v1/scout/findings?${params}`),
    refetchInterval: runs?.some(isOpen) ? POLL_MS : false,
  });
}

/** Pass on a job, or undo that. */
export function usePassFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, undo }: { id: string; undo?: boolean }) =>
      api.post<FindingItem>(
        `/v1/scout/findings/${id}/${undo ? "restore" : "pass"}`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scout-findings"] });
      qc.invalidateQueries({ queryKey: ["scout-runs"] });
      qc.invalidateQueries({ queryKey: ["scout-run"] });
      qc.invalidateQueries({ queryKey: ["email-events", "attention"] });
    },
  });
}

/** The settings that find the most jobs at the user's level. */
export function useRecommended() {
  return useQuery<Recommended>({
    queryKey: ["scout-recommended"],
    queryFn: () => api.get<Recommended>("/v1/scout/recommended"),
    staleTime: Infinity,
  });
}

/** The local companies Scout has checked, latest first. */
export function useCompanies() {
  return useQuery<Company[]>({
    queryKey: ["scout-companies"],
    queryFn: () => api.get<Company[]>("/v1/scout/companies"),
  });
}

/** Never check a company again (or start again), or check it next run. */
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      never_check?: boolean;
      check_next?: boolean;
    }) => api.patch<Company>(`/v1/scout/companies/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-companies"] }),
  });
}

// --------------------------------------------------------------------------
// The Instructions page and the run log
// --------------------------------------------------------------------------
export function useInstructions() {
  return useQuery({
    queryKey: ["scout-instructions"],
    queryFn: () => api.get<Instructions>("/v1/scout/instructions"),
  });
}

/** Save, reset or restore one section; the page and its history refresh. */
export function useChangeInstruction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      change:
        | { key: InstructionKey; text: string }
        | { key: InstructionKey; values: Record<string, number> }
        | { key: InstructionKey; reset: true }
        | { key: InstructionKey; restore: string },
    ) => {
      const base = `/v1/scout/instructions/${change.key}`;
      if ("reset" in change)
        return api.post<InstructionSection>(`${base}/reset`, {});
      if ("restore" in change)
        return api.post<InstructionSection>(
          `${base}/restore/${change.restore}`,
          {},
        );
      if ("text" in change)
        return api.put<InstructionSection>(base, { text: change.text });
      return api.put<InstructionSection>(base, { values: change.values });
    },
    onSuccess: (_s, change) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["scout-instructions"] }),
        qc.invalidateQueries({ queryKey: ["scout-instruction-history", change.key] }),
        qc.invalidateQueries({ queryKey: ["scout-preview"] }),
      ]),
  });
}

export function useInstructionHistory(key: InstructionKey, enabled: boolean) {
  return useQuery({
    queryKey: ["scout-instruction-history", key],
    queryFn: () =>
      api.get<InstructionVersion[]>(`/v1/scout/instructions/${key}/history`),
    enabled,
  });
}

/** What Claude would be given if this search started now. */
export function usePreview(missionId: string | null) {
  return useQuery({
    queryKey: ["scout-preview", missionId],
    queryFn: () =>
      api.get<Record<string, unknown>>(`/v1/scout/missions/${missionId}/preview`),
    enabled: !!missionId,
  });
}

export function useRunLog(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scout-run-log", runId],
    queryFn: () => api.get<RunEvent[]>(`/v1/scout/runs/${runId}/log`),
    enabled,
  });
}
