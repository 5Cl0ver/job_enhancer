import { useEffect, useRef, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import { FixTray, RowButton, type FixTarget, useFixer } from "@/components/apply/Bubbles";
import { ModeSwitch } from "@/components/apply/ModeSwitch";
import { cn } from "@/lib/utils";
import {
  type ApplyRun,
  type RunFix,
  type SheetStep,
  checkRows,
  fixFor,
  isOpenApply,
  nthOf,
  sheetOf,
  stepCounts,
  waitingFixes,
} from "@/lib/apply";

const FRESH_MS = 4000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "14 filled · 2 to check · 1 fix waiting": a step's (or the run's) counts. */
function countLine(filled: number, toCheck: number, waiting: number): string {
  return [`${filled} filled`, toCheck ? `${toCheck} to check` : "", waiting ? `${plural(waiting, "fix", "fixes")} waiting` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The target for one row's fix sheet. */
export function targetOf(step: SheetStep, i: number): FixTarget {
  const row = step.rows[i];
  return { step: step.key, stepTitle: step.title, q: row.q, a: row.a, k: nthOf(step, i), options: row.options, free: row.free };
}

/** Rows whose answer just changed light up for a moment (Claude at work). */
function useFresh(steps: SheetStep[], on: boolean) {
  const seen = useRef(new Map<string, string>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!on) return;
    const changed = new Set<string>();
    for (const s of steps) {
      s.rows.forEach((r, i) => {
        const key = `${s.key}|${i}`;
        const before = seen.current.get(key);
        if (before !== undefined && before !== r.a) changed.add(key);
        seen.current.set(key, r.a);
      });
    }
    if (changed.size) setFresh(changed);
  }, [steps, on]);
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);
  return fresh;
}

/**
 * One step as a group (spec 033): its name and counts on one line; tap to
 * open its rows. Shared by Your application, the step check and the review.
 */
export function StepGroup({
  step,
  fixes,
  open,
  onToggle,
  now = false,
  fresh,
  onTap,
}: {
  step: SheetStep;
  fixes?: RunFix[];
  open: boolean;
  onToggle: () => void;
  now?: boolean;
  fresh?: Set<string>;
  onTap?: (target: FixTarget) => void;
}) {
  const { filled, toCheck } = stepCounts(step);
  const waiting = (fixes ?? []).filter((f) => f.step === step.key && f.status === "waiting").length;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/40"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{step.title}</span>
            {now && <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[11px] leading-5 text-primary">Now</span>}
          </span>
          <span className="block text-xs text-muted-foreground">{countLine(filled, toCheck, waiting)}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-0.5 px-1 pb-2" aria-label={step.title}>
          {step.rows.map((row, i) => (
            <li key={`${i}-${row.q}`}>
              <RowButton
                row={row}
                fix={fixFor(fixes, step.key, row.q, nthOf(step, i))}
                fresh={fresh?.has(`${step.key}|${i}`)}
                onTap={onTap && (() => onTap(targetOf(step, i)))}
              />
            </li>
          ))}
          {!step.rows.length && <li className="px-3 py-1 text-xs text-muted-foreground">No boxes on this step.</li>}
        </ul>
      )}
    </li>
  );
}

/** Which steps are open: the one being filled (finished ones fold away),
 * plus any the owner opened or closed by hand. */
export function useOpenSteps(auto: string | null) {
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  return {
    isOpen: (key: string) => (key === auto) !== flipped.has(key),
    toggle: (key: string) =>
      setFlipped((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  };
}

/**
 * Your application (spec 033): one list that keeps growing for the whole run,
 * grouped by the site's steps. Every box shows once, with its tag; tap one to
 * change it or ask Claude: the fix waits for the right moment.
 */
export function YourApplication({ run }: { run: ApplyRun }) {
  const sheet = sheetOf(run);
  const filling = run.status === "filling" || run.status === "needs_you";
  const current = sheet.current ?? sheet.steps[sheet.steps.length - 1]?.key ?? null;
  const fresh = useFresh(sheet.steps, filling);
  const steps = useOpenSteps(filling && !run.paused_step ? current : null);
  const fixer = useFixer(run);

  if (!sheet.steps.length) {
    if (!filling) return null;
    // An older Job Catcher can't read the page for this.
    return run.job_catcher?.new_enough && run.job_catcher.live === false ? (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        Update Job Catcher to watch the boxes fill here.
      </p>
    ) : null;
  }
  const filled = sheet.steps.reduce((n, s) => n + stepCounts(s).filled, 0);
  const toCheck = checkRows(sheet).length;
  const waiting = waitingFixes(run).length;
  const currentTitle = sheet.steps.find((s) => s.key === current)?.title;
  const lead = filling && currentTitle && !run.paused_step ? `Filling ${currentTitle}` : null;
  return (
    <section className="rounded-lg border" aria-label="Your application">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-4 pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            {filling && !run.paused_step && <Radio className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden />}
            {run.status === "sent" ? "What you sent" : "Your application"}
          </h2>
          <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {[lead, countLine(filled, toCheck, waiting)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {isOpenApply(run) && run.status !== "review" && run.status !== "submitting" && <ModeSwitch run={run} />}
      </div>
      <ol className="divide-y border-t">
        {sheet.steps.map((step) => (
          <StepGroup
            key={step.key}
            step={step}
            fixes={run.fixes}
            open={steps.isOpen(step.key)}
            onToggle={() => steps.toggle(step.key)}
            now={filling && step.key === current}
            fresh={fresh}
            onTap={fixer.open}
          />
        ))}
      </ol>
      {fixer.open && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Tap any box to change it or ask Claude.</p>}
      {fixer.open && run.status !== "review" && (
        <div className="px-2 pb-2">
          <FixTray run={run} />
        </div>
      )}
      {fixer.sheet}
    </section>
  );
}
