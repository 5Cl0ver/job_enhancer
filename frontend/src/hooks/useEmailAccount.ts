/**
 * TanStack Query hooks for email auto-status.
 * Powers the "Connect Email" card in Settings: connect an inbox, scan it, and
 * review the pipeline updates the scan detects (approve / dismiss / undo).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ProviderInfo {
  provider: string;
  label: string;
  connect_method: "app_password" | "oauth" | "forward";
  imap_host: string;
  imap_port: number;
  guide: string;
}

export interface EmailAccount {
  id: string;
  email_address: string;
  provider: string;
  auth_type: string;
  imap_host: string;
  imap_port: number;
  status: "connected" | "error";
  last_error: string | null;
  last_scan_at: string | null;
  created_at: string;
}

export interface DetectedEvent {
  id: string;
  saved_job_id: string;
  event_type: "applied" | "interview" | "rejected" | "recruiter";
  target_stage: string | null;
  from_addr: string;
  subject: string;
  status: string;
  created_at: string;
}

export interface ScanResult {
  detected: number;
  events: DetectedEvent[];
}

/** The user's connected inbox, or null when none is connected. */
export function useEmailAccount() {
  return useQuery<EmailAccount | null>({
    queryKey: ["email-account"],
    queryFn: () => api.get<EmailAccount | null>("/v1/email/account"),
    staleTime: 30_000,
  });
}

/** Detect how to connect an address (drives which form/guide to show). */
export function useProviderInfo(address: string) {
  const valid = /.+@.+\..+/.test(address);
  return useQuery<ProviderInfo>({
    queryKey: ["email-provider", address.trim().toLowerCase()],
    queryFn: () =>
      api.get<ProviderInfo>(
        `/v1/email/provider?address=${encodeURIComponent(address.trim())}`,
      ),
    enabled: valid,
    staleTime: 5 * 60_000,
  });
}

export interface ConnectPayload {
  email_address: string;
  app_password: string;
  imap_host?: string;
  imap_port?: number;
}

export function useConnectEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectPayload) =>
      api.post<EmailAccount>("/v1/email/connect", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-account"] }),
  });
}

export function useDisconnectEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/v1/email/account"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-account"] });
      qc.invalidateQueries({ queryKey: ["email-events"] });
    },
  });
}

/** Pending updates the scan detected, awaiting review. */
export function useDetectedEvents() {
  return useQuery<DetectedEvent[]>({
    queryKey: ["email-events"],
    queryFn: () => api.get<DetectedEvent[]>("/v1/email/events"),
    staleTime: 15_000,
  });
}

export function useScanInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ScanResult>("/v1/email/scan", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["email-account"] });
    },
  });
}

type ReviewAction = "apply" | "dismiss" | "undo";

/** Approve / dismiss / undo a detected event; refreshes the board on move. */
export function useReviewEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReviewAction }) =>
      api.post<DetectedEvent>(`/v1/email/events/${id}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}
