/**
 * Wake the server before Claude needs it (spec 040). The free server sleeps
 * when nobody uses it, and waking takes about a minute: Claude's side panel
 * then sits on "Loading tools…". A start card asks it to wake as soon as it
 * shows, so it's up by the time the line is pasted into Claude.
 */
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";

/** One /health visit that waits out a wake-up (no sign-in needed). */
async function health(): Promise<boolean> {
  const res = await fetch(`${API_BASE.replace(/\/+$/, "")}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return true;
}

/** True once the server answered; tries for about two minutes. */
export function useServerReady(enabled = true) {
  const q = useQuery({
    queryKey: ["server-ready"],
    queryFn: health,
    enabled,
    staleTime: 5 * 60_000,
    retry: 8,
    retryDelay: (n) => Math.min(15_000, 2_000 * 2 ** n),
  });
  return { ready: q.isSuccess, failed: q.isError };
}
