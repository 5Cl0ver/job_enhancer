import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowButton, useFixer } from "@/components/apply/Bubbles";
import { targetOf } from "@/components/apply/YourApplication";
import { useContinue } from "@/hooks/useApply";
import { type ApplyRun, fixFor, nthOf, sheetOf, waitingFixes } from "@/lib/apply";

/**
 * Page by page (spec 033): Claude finished a step and waits. The step's
 * boxes, open; tap one to change it. One big Continue sends that step's
 * fixes, and Claude carries on.
 */
export function StepCheck({ run }: { run: ApplyRun }) {
  const go = useContinue();
  const fixer = useFixer(run);
  if (run.status !== "filling" || !run.paused_step) return null;
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
