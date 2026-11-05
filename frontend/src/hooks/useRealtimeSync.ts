import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { SavedJob } from "@/types/api";

/** Queries that display saved jobs and are refreshed on a remote change. */
const SYNCED_KEYS = [["saved-jobs"], ["tracker"], ["analytics"], ["matches"]];
/** Coalesce bursts (e.g. a bulk application import) into one refresh. */
const DEBOUNCE_MS = 1500;

type SavedJobRow = { id?: string; updated_at?: string };

function sameInstant(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return Date.parse(a) === Date.parse(b);
}

/**
 * True when the cached saved-job lists already reflect this change, so a
 * refetch would only re-download what we have. That's the echo of our own
 * edit: the mutation already refetched and the cache holds the new row.
 */
function alreadyInCache(
  qc: QueryClient,
  change: RealtimePostgresChangesPayload<SavedJobRow>,
): boolean {
  const lists = qc
    .getQueriesData<SavedJob[]>({ queryKey: ["saved-jobs"] })
    .map(([, data]) => data)
    .filter((d): d is SavedJob[] => Array.isArray(d));
  if (lists.length === 0) return false;
  const find = (id?: string) =>
    id ? lists.flat().find((j) => j.id === id) : undefined;

  if (change.eventType === "DELETE") {
    return !find(change.old?.id); // gone from every cached list already
  }
  const row = change.new;
  const cached = find(row?.id);
  if (!cached) return false;
  if (change.eventType === "INSERT") return true;
  return sameInstant(cached.updated_at, row?.updated_at);
}

/**
 * Live sync between the app, the browser extension, and any other open tab.
 *
 * Supabase Realtime streams Postgres row changes over a WebSocket. We subscribe
 * to changes on `saved_jobs`; when one lands (a save from the extension, an
 * unsave in another tab, a stage move…) we invalidate the queries that display
 * them so TanStack Query refetches and the UI updates without a refresh.
 *
 * To keep database egress down, refreshes are debounced, skipped when the
 * cache already holds the change (the echo of our own edits), and deferred
 * while the tab is hidden: a hidden tab only marks the data stale, and
 * `refetchOnWindowFocus` reloads it when the user comes back.
 *
 * Security: Realtime enforces Row-Level Security, so this only ever receives the
 * current user's own rows (see backend/supabase/enable_realtime_saved_jobs.sql).
 * We hand Realtime the user's access token via `setAuth` so RLS can identify
 * them, and keep it fresh when the session token rotates.
 */
export function useRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: RealtimePostgresChangesPayload<SavedJobRow>[] = [];

    const refresh = () => {
      timer = null;
      const changes = pending;
      pending = [];
      // Checked now, after the debounce, so our own mutation's refetch has
      // had time to land in the cache.
      if (changes.every((c) => alreadyInCache(qc, c))) return;
      const refetchType = document.visibilityState === "hidden" ? "none" : "active";
      for (const queryKey of SYNCED_KEYS) {
        qc.invalidateQueries({ queryKey, refetchType });
      }
    };

    const onChange = (change: RealtimePostgresChangesPayload<SavedJobRow>) => {
      pending.push(change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, DEBOUNCE_MS);
    };

    // Keep Realtime authenticated as the current user (RLS reads this token).
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      supabase.realtime.setAuth(token);

      channel = supabase
        .channel("saved_jobs_sync")
        .on<SavedJobRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: "saved_jobs" },
          onChange,
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);
}

export const __test__ = { alreadyInCache, DEBOUNCE_MS };
