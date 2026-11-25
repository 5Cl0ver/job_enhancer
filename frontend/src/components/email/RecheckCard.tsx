import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecheck } from "@/hooks/useEmailAccount";
import { ApiError } from "@/lib/api";

const DAYS = 30;

/**
 * "Missed an email?" (spec 027): reads the last 30 days again with today's
 * rules. It only adds emails not seen before and never moves a card; it runs
 * on the server for a few minutes, so leaving the page is fine.
 */
export function RecheckCard() {
  const { status, start } = useRecheck();
  const running = status?.state === "running" || start.isPending;
  const error =
    start.error instanceof ApiError
      ? start.error.status === 409
        ? "A scan is running. Try again when it's done."
        : start.error.message
      : start.isError
        ? "Couldn't start it. Try again."
        : status?.state === "failed"
          ? "The re-check didn't finish. Try again."
          : null;

  return (
    <section className="mb-6 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <History
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          Missed an email?
        </p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {running
            ? "Re-checking the last 30 days. This takes a few minutes; you can leave this page."
            : status?.state === "done"
              ? status.found
                ? `Found ${status.found} email${status.found === 1 ? "" : "s"}: ${status.noted ?? 0} kept on your jobs, ${status.waiting ?? 0} waiting for you. No card was moved.`
                : "Nothing was missed in the last 30 days."
              : "Read the last 30 days again. Only adds what was missed; never moves a card."}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5 pointer-coarse:h-11"
        disabled={running}
        onClick={() => start.mutate(DAYS)}
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <History className="h-4 w-4" aria-hidden />
        )}
        {running ? "Re-checking…" : "Re-check 30 days"}
      </Button>
    </section>
  );
}
