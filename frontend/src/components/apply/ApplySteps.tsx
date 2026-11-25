import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, type StepKey, stepIndex } from "@/lib/apply";

/**
 * Start → Questions → Résumé → Application → Your review → Sent. Done steps get
 * a tick, the current one is filled in. On a phone the labels shrink to the
 * current step's name under the dots, so the row never wraps.
 */
export function ApplySteps({ step, ended }: { step: StepKey; ended: boolean }) {
  const at = stepIndex(step);
  return (
    <div>
      <ol className="flex items-center gap-1" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < at || (ended && i === at && step === "sent");
          const current = i === at && !done;
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-primary text-primary ring-2 ring-primary/30",
                  !done && !current && "text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate text-xs max-sm:hidden",
                  current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px min-w-2 flex-1 bg-border" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-xs text-muted-foreground sm:hidden">
        Step {at + 1} of {STEPS.length}: {STEPS[at].label}
      </p>
    </div>
  );
}
