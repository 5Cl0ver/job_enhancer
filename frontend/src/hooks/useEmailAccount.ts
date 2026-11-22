/**
 * TanStack Query hooks for email auto-status.
 * Powers the "Connect Email" card in Settings: connect an inbox, scan it, and
 * review the pipeline updates the scan detects (approve / dismiss / undo), and
 * resolve the items it couldn't decide (pick the job, or dismiss).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { scanIsDone } from "@/lib/emailUpdates";

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
  /** unsaved only: the saved job it most likely belongs to, if one stands out. */
  likely_job?: MatchCandidate | null;
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
  /** Where the saved job's card is now ("Interested"); null if unsaved. */
  current_stage?: string | null;
  /** The email in the user's webmail: the message itself when it can be named,
   * else a search for it. */
  mail_link: string | null;
  /** Always a search, for when the direct link doesn't land on the email. */
  mail_search_link?: string | null;
  /** When the email was sent; null for emails recorded before this was kept. */
  email_date?: string | null;
  /** When a scan found the email. */
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
  | "template"
  | "likely_job"
  | "user_link"
  | "not_this_job";

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
  /** Important updates about jobs you haven't saved. */
  unsaved?: number;
  /** Per-folder progress: a folder is done when "complete" with nothing left. */
  folders?: { role: string; status: string; carried_over: number }[];
  carried_over?: number;
  /** Why a pass stopped early (rate_limited, connection_lost, …). */
  interrupted?: string | null;
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

/** Most passes one click runs; each pass reads about a minute of mail. */
const MAX_PASSES = 30;
/** A dropped connection (the server restarting, a flaky network) is tried
 * again this many times, this far apart: about two minutes in all. What a
 * pass read before the drop is saved, so a retry picks up where it stopped. */
const RETRIES = 6;
const RETRY_MS = 20_000;

/** Worth trying again: no answer at all, the server restarting (502–504), or
 * the server still finishing the pass whose answer was lost (409). */
function retryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 409 || e.status === 502 || e.status === 503 || e.status === 504;
}

export interface FullScan {
  running: boolean;
  passes: number;
  read: number;
  found: number;
  moved: number;
  windowDays: number;
  done: boolean;
  error: string | null;
  /** The connection dropped; trying again in a moment. */
  retrying: boolean;
}

const IDLE: FullScan = {
  running: false,
  passes: 0,
  read: 0,
  found: 0,
  moved: 0,
  windowDays: 0,
  done: false,
  error: null,
  retrying: false,
};

/** One click reads the whole inbox: scan passes run back to back until every
 * folder is done, refreshing the page's updates after each pass. */
export function useFullScan() {
  const qc = useQueryClient();
  const [state, setState] = useState<FullScan>(IDLE);

  const run = async () => {
    let s: FullScan = { ...IDLE, running: true };
    setState(s);
    let tries = 0;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      let r: ScanResult;
      try {
        r = await api.post<ScanResult>("/v1/email/scan", {});
        tries = 0;
      } catch (e) {
        if (retryable(e) && tries < RETRIES) {
          tries++;
          s = { ...s, retrying: true };
          setState(s);
          await new Promise((done) => setTimeout(done, RETRY_MS));
          s = { ...s, retrying: false };
          setState(s);
          pass--; // the same pass again
          continue;
        }
        const error =
          e instanceof ApiError && e.status === 429
            ? "Yahoo asked us to slow down. What's read so far is saved — scan again in a few minutes."
            : e instanceof ApiError && !retryable(e)
              ? e.message
              : "Couldn't reach the app for a few minutes. What's read so far is saved — scan again soon.";
        s = { ...s, running: false, error };
        break;
      }
      s = {
        ...s,
        passes: pass,
        read: s.read + r.scanned,
        found: s.found + r.detected + (r.review?.length ?? 0) + (r.unsaved ?? 0),
        moved: s.moved + (r.moved ?? 0),
        windowDays: r.window_days,
        done: scanIsDone(r),
      };
      setState(s);
      qc.invalidateQueries({ queryKey: ["email-events"] });
      qc.invalidateQueries({ queryKey: ["job-emails"] });
      if (s.done) break;
    }
    qc.invalidateQueries({ queryKey: ["email-account"] });
    setState({ ...s, running: false });
  };

  return { ...state, run };
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
  mail_search_link?: string | null;
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

/** The email that explains where a saved job's card sits. */
export interface JobEmailLatest {
  saved_job_id: string;
  event_id: string;
  event_type: string;
  status: string;
  target_stage: string | null;
  email_date?: string | null;
  created_at: string;
  mail_link?: string | null;
  mail_search_link?: string | null;
  /** How many emails explain the job's stage. */
  count: number;
}

/** For every saved job with emails, the one behind its stage, by saved-job id.
 * One request for the whole board. The key sits under "email-events" so any
 * email action refreshes it. */
export function useJobEmailLatest() {
  return useQuery({
    queryKey: ["email-events", "job-latest"],
    queryFn: () => api.get<JobEmailLatest[]>("/v1/email/job-emails/latest"),
    select: bySavedJob,
    staleTime: 60_000,
  });
}

function bySavedJob(rows: JobEmailLatest[]): Map<string, JobEmailLatest> {
  return new Map(rows.map((r) => [r.saved_job_id, r]));
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
