import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Live sync between the app, the browser extension, and any other open tab.
 *
 * Supabase Realtime streams Postgres row changes over a WebSocket. We subscribe
 * to changes on `saved_jobs`; whenever one lands (a save from the extension, an
 * unsave in another tab, a stage move…), we invalidate the queries that display
 * them so TanStack Query refetches and the UI updates instantly — no refresh,
 * even while this tab is in the background.
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

    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["saved-jobs"] });
      qc.invalidateQueries({ queryKey: ["tracker"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
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
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "saved_jobs" },
          refresh,
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);
}
