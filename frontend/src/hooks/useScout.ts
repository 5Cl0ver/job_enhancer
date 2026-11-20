/**
 * TanStack Query hooks for Claude Scout: resume types (tracks), saved searches
 * (missions) and runs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  isOpen,
  type Mission,
  type MissionInput,
  type Run,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scout-tracks"] }),
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

/** Upload a resume for one resume type without replacing the main resume
 * (the one match scores and autofill use). */
export function useUploadTrackResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<{ id: string; filename: string }>(
        "/v1/ai/resumes?make_active=false",
        form,
      );
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
      const form = new FormData();
      form.append("file", file);
      const uploaded = await api.post<{ id: string }>(
        "/v1/ai/resumes?make_active=false",
        form,
      );
      // Skills are a bonus: a failure here must not lose the upload.
      const skills =
        track.key_skills.length === 0
          ? await resumeSkills(uploaded.id).catch(() => [])
          : [];
      await api.patch<Track>(`/v1/scout/tracks/${track.id}`, {
        resume_id: uploaded.id,
        ...(skills.length > 0 ? { key_skills: skills } : {}),
      });
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
      if (run.counts.saved) qc.invalidateQueries({ queryKey: ["saved-jobs"] });
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
