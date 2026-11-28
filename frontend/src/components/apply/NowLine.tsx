import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ago } from "@/lib/ago";
import { type ApplyRun, isOpenApply, needsYou } from "@/lib/apply";

/** The newest problem Claude noted since its last step: what it's stuck on. */
export function stuckOn(run: Pick<ApplyRun, "events" | "problems">): string | null {
  const last = run.events[run.events.length - 1]?.at ?? "";
  const open = (run.problems ?? []).filter((p) => (p.status ?? "open") === "open" && p.at > last);
  return open.length ? open[open.length - 1].what : null;
}

/**
 * What Claude is doing now (spec 040): its last step and how long ago, so a
 * slow résumé or a long fill never looks stuck, and what it ran into since,
 * when it noted a problem. Only while it's Claude's turn.
 */
export function NowLine({ run }: { run: ApplyRun }) {
  const [now, setNow] = useState(() => Date.now());
  const going = isOpenApply(run) && !needsYou(run) && run.status !== "waiting";
  useEffect(() => {
    if (!going) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [going]);
  if (!going) return null;
  const last = run.events[run.events.length - 1];
  const stuck = stuckOn(run);
  return (
    <div className="space-y-1 text-sm" aria-live="polite">
      {last && (
        <p className="text-muted-foreground">
          Last step: {last.text} <span className="whitespace-nowrap">· {ago(last.at, now)}</span>
        </p>
      )}
      {stuck && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 break-words">
            Claude ran into a problem: {stuck} Message Claude below if it needs your help.
          </span>
        </p>
      )}
    </div>
  );
}
