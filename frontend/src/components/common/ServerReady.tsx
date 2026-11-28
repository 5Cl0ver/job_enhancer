import { CheckCircle2, Loader2 } from "lucide-react";
import { useServerReady } from "@/hooks/useServerReady";

/**
 * "Getting the server ready…" until the server answers (spec 040), so the
 * line pasted into Claude finds it awake. One quiet line on a start card.
 */
export function ServerReady() {
  const { ready, failed } = useServerReady();
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {ready ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Server ready
        </>
      ) : failed ? (
        "The server isn't answering yet. Give it a minute, then paste the line."
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Getting the server ready…
        </>
      )}
    </p>
  );
}
