import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowButton, useFixer } from "@/components/apply/Bubbles";
import { targetOf } from "@/components/apply/YourApplication";
import { useContinue } from "@/hooks/useApply";
import { type ApplyRun, fixFor, nthOf, sheetOf, waitingFixes } from "@/lib/apply";
import { cn } from "@/lib/utils";

/**
 * Page by page (spec 033): Claude finished a step and waits. The step's
 * boxes, open; tap one to change it. One big Continue sends that step's
 * fixes, and Claude carries on.
 */
export function StepCheck({ run }: { run: ApplyRun }) {
  const go = useContinue();
  const fixer = useFixer(run);
  if (run.status !== "filling") return null;
  if (!run.paused_step) return <ContinueSent run={run} />;
  const step = sheetOf(run).steps.find((s) => s.key === run.paused_step);
  const title = step?.title ?? run.paused_title ?? "This step";
  const mine = waitingFixes(run).filter((f) => f.step === run.paused_step).length;
  return (
    <section className="space-y-3 rounded-lg border border-primary/50 bg-primary/5 p-4" aria-label="Look it over">
      <div>
        <h2 className="text-base font-semibold">{title} is done: look it over</h2>
        <p className="text-sm text-muted-foreground">Tap anything to change it. Claude waits for you.</p>
      </div>
      {step && step.rows.length > 0 && (
        <ul className="-mx-2 space-y-0.5 rounded-lg bg-background/80 p-1">
          {step.rows.map((row, i) => (
            <li key={`${i}-${row.q}`}>
              <RowButton
                row={row}
                fix={fixFor(run.fixes, step.key, row.q, nthOf(step, i))}
                onTap={fixer.open && (() => fixer.open!(targetOf(step, i)))}
              />
            </li>
          ))}
        </ul>
      )}
      <Button size="lg" className="h-12 w-full gap-2 text-base" disabled={go.isPending} onClick={() => go.mutate(run.id)}>
        {go.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
        {mine ? `Continue with ${mine} fix${mine === 1 ? "" : "es"}` : "Looks good, continue"}
      </Button>
      {go.isError && <p className="text-sm text-destructive">{(go.error as Error).message}</p>}
      {fixer.sheet}
    </section>
  );
}

/** How long a Continue may wait for Claude before the owner is told to nudge it. */
export const NOT_PICKED_UP_MS = 2 * 60_000;

/**
 * After Continue (spec 038): did it reach Claude? "Sent to Claude…" until
 * Claude gets it, then "Claude got it", until Claude fills the next step. If
 * Claude hasn't picked it up in 2 minutes, the owner is told what to say.
 */
function ContinueSent({ run }: { run: ApplyRun }) {
  const check = run.sheet?.check;
  const [, redraw] = useState(0);
  const at = check ? new Date(check.at).getTime() : 0;
  const unread = !!check && !check.read;
  // Unread: draw again when the 2 minutes are up (no new data comes then).
  useEffect(() => {
    if (!unread) return;
    const left = NOT_PICKED_UP_MS - (Date.now() - at);
    if (left < 0) return;
    const t = setTimeout(() => redraw((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [unread, at]);
  // A check from before spec 038 has no moved_on: once read, it's done.
  if (!check || check.moved_on || check.keep || (check.moved_on === undefined && check.read)) return null;
  const late = !check.read && Date.now() - at > NOT_PICKED_UP_MS;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        late ? "border-amber-500/50 bg-amber-500/10" : "border-primary/30 bg-primary/5",
      )}
    >
      {check.read ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      ) : late ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
      )}
      <span>
        {check.read
          ? "Claude got it."
          : late
            ? "Claude hasn't picked this up. In the chat, tell it: carry on"
            : "Sent to Claude…"}
      </span>
    </p>
  );
}
