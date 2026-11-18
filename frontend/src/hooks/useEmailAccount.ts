/**
 * TanStack Query hooks for email auto-status.
 * Powers the "Connect Email" card in Settings: connect an inbox, scan it, and
 * review the pipeline updates the scan detects (approve / dismiss / undo), and
 * resolve the items it couldn't decide (pick the job, or dismiss).
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
  /** Move cards by themselves when a scan is sure which job an email is about. */
  auto_move?: boolean;
  created_at: string;
}

export interface DetectedEvent {
  id: string;
  /** null only for a needs_review item whose job hasn't been chosen yet. */
  saved_job_id: string | null;
  job_listing_id: string | null;
  event_type:
    | "applied"
    | "interview"
    | "assessment"
    | "offer"
    | "rejected"
    | "recruiter"
    | "unsure";
  target_stage: string | null;
  /** The target stage was deleted: approving can't move the card. */
  stage_missing?: boolean;
  /** How the job was chosen, or why it needs review (stored with it). */
  match_evidence?: MatchEvidence | null;
  /** needs_review only: why ("unsure" = unclear what the email says). */
  review_reason?: ReviewReason | null;
  /** needs_review only: the saved jobs it could be about. */
  candidates?: MatchCandidate[];
  from_addr: string;
  subject: string;
  status:
    | "pending"
    | "needs_review"
    | "hidden"
    | "unsaved"
    | "contact"
    | "applied"
    | "auto_applied"
    | "dismissed";
  /** Where the Email Updates page shows it. */
  category?: EmailCategory;
  /** The chosen job's names, for a plain sentence. */
  company?: string | null;
  title?: string | null;
  mail_link: string | null;
  created_at: string;
}

/** Evidence a match was made on, or why it needs review. */
export type MatchEvidence =
  | "job_url"
  | "job_id"
  | "known_sender"
  | "company_title"
  | "company_date"
  | "title_only"
  | "several_roles"
  | "several_jobs"
  | "fuzzy_company"
  | "company_only"
  | "conflicting_evidence"
  | "template";

export type ReviewReason = MatchEvidence | "unsure" | "no_match";

/** moved: a card the scan moved by itself (sure match; can be undone) ·
 * important: interview/assessment/offer/rejection with a clear job ·
 * confirmation: application received · question: an important update whose
 * job is unclear · hidden: low-value, kept out of the way. */
export type EmailCategory =
  | "moved"
  | "important"
  | "confirmation"
  | "question"
  | "unsaved"
  | "contact"
  | "hidden";

/** Update types the user can pick for an unsure email (ones that move a card). */
export type ResolvableType =
  | "applied"
  | "interview"
  | "assessment"
  | "offer"
  | "rejected";

export interface MatchCandidate {
  company: string;
  title: string;
  job_listing_id: string | null;
  /** Present on stored review items: what a one-click resolve sends. */
  saved_job_id?: string | null;
}

export interface Considered {
  from_addr: string;
  subject: string;
  event_type: DetectedEvent["event_type"];
  reason:
    | "no_confident_match"
    | "filtered_contact"
    | "reminder"
    | "already_at_or_past_stage"
    | "needs_review";
  matched_company: string | null;
  matched_title: string | null;
  matched_job_listing_id: string | null;
  mail_link: string | null;
  date: string | null;
  match_evidence?: MatchEvidence | null;
  /** needs_review: the saved jobs it could be about. */
  candidates?: MatchCandidate[];
}

export interface ScanResult {
  detected: number;
  events: DetectedEvent[];
  /** New questions this scan stored (also listed by /events). */
  review?: DetectedEvent[];
  /** Cards this scan moved by itself (sure matches). */
  moved?: number;
  /** New low-value items stored hidden, and what was skipped (counts). */
  hidden?: number;
  skipped?: Record<string, number>;
  considered: Considered[];
  scanned: number;
  candidates: number;
  window_days: number;
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

/** Change Email Updates settings (whether sure updates move cards). */
export function useEmailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: { auto_move: boolean }) =>
      api.patch<EmailAccount>("/v1/email/account", settings),
    onSuccess: (account) => qc.setQueryData(["email-account"], account),
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

/** Pending updates and needs-review items, awaiting the user. */
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

/** Say which saved job a needs-review item is about (and its type, if unsure).
 * It becomes a pending update; nothing moves until it's approved. */
export function useResolveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      savedJobId,
      eventType,
    }: {
      id: string;
      savedJobId: string;
      eventType?: ResolvableType;
    }) =>
      api.post<DetectedEvent>(`/v1/email/events/${id}/resolve`, {
        saved_job_id: savedJobId,
        ...(eventType ? { event_type: eventType } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-events"] }),
  });
}

export interface EmailMessage {
  subject: string;
  from_addr: string;
  date: string | null;
  /** Plain text only — the server never sends email HTML. */
  text: string;
  mail_link: string | null;
}

/** One detected email, fetched read-only from the mailbox when asked. */
export function useEmailMessage(eventId: string | null) {
  return useQuery<EmailMessage>({
    queryKey: ["email-message", eventId],
    queryFn: () => api.get<EmailMessage>(`/v1/email/events/${eventId}/message`),
    enabled: !!eventId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Detected emails tied to one saved job (by its listing id). */
export function useJobEmails(jobListingId: string) {
  return useQuery<DetectedEvent[]>({
    queryKey: ["job-emails", jobListingId],
    queryFn: () =>
      api.get<DetectedEvent[]>(
        `/v1/email/job-emails?job_listing_id=${encodeURIComponent(jobListingId)}`,
      ),
    enabled: !!jobListingId,
    staleTime: 60_000,
  });
}

/** Answer a question in one click: this email is about that job — update
 * its card. (Resolve, then apply; the click is the user's approval.) */
export function useAnswerQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, savedJobId }: { id: string; savedJobId: string }) => {
      await api.post<DetectedEvent>(`/v1/email/events/${id}/resolve`, {
        saved_job_id: savedJobId,
      });
      return api.post<DetectedEvent>(`/v1/email/events/${id}/apply`, {});
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}

/** Add the job an unsaved update is about to My Jobs (the user's click).
 * Dismisses repeats of the same update so the line goes away in one step. */
export function useTrackEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      repeats,
      company,
      title,
    }: {
      lead: DetectedEvent;
      repeats: DetectedEvent[];
      company: string;
      title: string;
    }) => {
      const done = await api.post<DetectedEvent>(`/v1/email/events/${lead.id}/track`, {
        company,
        title,
      });
      for (const r of repeats) {
        await api.post<DetectedEvent>(`/v1/email/events/${r.id}/dismiss`, {});
      }
      return done;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}

/** Act on a line that stands for several emails: apply the newest and clear
 * its repeats, or clear them all. One click, one decision. */
export function useGroupAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      repeats,
      action,
    }: {
      lead: DetectedEvent;
      repeats: DetectedEvent[];
      action: "apply" | "dismiss";
    }) => {
      const done = await api.post<DetectedEvent>(
        `/v1/email/events/${lead.id}/${action}`,
        {},
      );
      for (const r of repeats) {
        await api.post<DetectedEvent>(`/v1/email/events/${r.id}/dismiss`, {});
      }
      return done;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
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
      qc.invalidateQueries({ queryKey: ["job-emails"] });
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });
}
