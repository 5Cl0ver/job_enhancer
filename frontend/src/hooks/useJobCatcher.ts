/**
 * TanStack Query hooks for Job Catcher (spec 019): the newest release, the
 * computers it's connected on, disconnecting one, and approving a Connect.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface JobCatcherRelease {
  version: string | null;
  notes: string;
  published_at: string | null;
  sha256: string | null;
  download_url: string;
}

export interface JobCatcherConnection {
  id: string;
  browser: string | null;
  version: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function useJobCatcherRelease() {
  return useQuery<JobCatcherRelease>({
    queryKey: ["job-catcher", "latest"],
    queryFn: () => api.get<JobCatcherRelease>("/v1/extension/latest"),
    staleTime: 10 * 60_000,
  });
}

export function useJobCatcherConnections() {
  return useQuery<JobCatcherConnection[]>({
    queryKey: ["job-catcher", "connections"],
    queryFn: () => api.get<JobCatcherConnection[]>("/v1/extension/tokens"),
  });
}

/** Disconnect one computer: its Job Catcher is signed out at once. */
export function useDisconnectJobCatcher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/extension/tokens/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-catcher", "connections"] }),
  });
}

/** Is this Connect code still waiting? (404 when it isn't.) */
export function useConnectStatus(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ["job-catcher", "connect", code],
    queryFn: () =>
      api.post<{ status: string; expires_in: number }>("/v1/extension/connect/status", { code }),
    enabled: enabled && !!code,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useApproveConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string; proof: string }) =>
      api.post<{ status: string }>("/v1/extension/connect/approve", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-catcher", "connections"] }),
  });
}

export function useCancelConnect() {
  return useMutation({
    mutationFn: (code: string) => api.post("/v1/extension/connect/cancel", { code }),
  });
}
