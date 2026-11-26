import { useState } from "react";
import { ChevronDown, Loader2, MousePointerClick, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FixTray, RowButton, useFixer } from "@/components/apply/Bubbles";
import { Pages } from "@/components/apply/Pages";
import { StepGroup, useOpenSteps } from "@/components/apply/YourApplication";
import { useDecide, useMarkSent } from "@/hooks/useApply";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import { type ApplyRun, checkRows, fixFor, sheetOf, waitingFixes } from "@/lib/apply";

/**
 * The user's call before anything is sent: Submit (Claude presses it), Fix
 * something (Claude fixes and asks again), or I'll submit it myself (on the
 * computer: Job Catcher lifts its Submit block and notices the press).
 */
export function Review({ run }: { run: ApplyRun }) {
  const decide = useDecide();
  const sent = useMarkSent();
  const phone = useIsPhone();
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [changing, setChanging] = useState(false);
  const review = run.review;
  const decision = changing ? null : review?.decision;
  const pending = waitingFixes(run).length;
  // Fixes the user added but didn't send would be left behind.
  const dropFixes = () =>
    !pending || window.confirm(`You have ${pending} fix${pending === 1 ? "" : "es"} not sent. Go on without them?`);
  // What the user told Claude in a chat, in their own words (spec 022).
  const told = review?.by === "chat" && review.words && (
    <p className="text-sm">
      You told Claude: <q className="italic">{review.words}</q>
    </p>
  );
  // Fixes left in the tray when the review was answered (in a chat): never
  // lost without a word.
  const unsent = pending > 0 && (decision === "submit" || decision === "self") && (
    <p className="text-sm text-amber-700 dark:text-amber-400">
      {pending === 1 ? "1 fix wasn't sent" : `${pending} fixes weren't sent`}. Press Change my answer to send them.
    </p>
  );
  // Decided, and Claude hasn't acted on it yet: it can still be changed.
  const change = run.status === "review" && (
    <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
      Change my answer
    </Button>
  );

  if (run.status === "review" && decision === "self") {
    return (
      <div className="space-y-2">
        {told}
        {unsent}
        <p className="text-sm">
          Go to the application's tab and press its <strong>Submit</strong> button. Job Catcher notices and
          moves the job to Applied.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => sent.mutate(run.id)} disabled={sent.isPending}>
            I sent it
          </Button>
          {change}
        </div>
      </div>
    );
  }
  if (run.status === "review" && decision) {
    return (
      <div className="space-y-2">
        {told}
        {unsent}
        <p className="text-sm">
          {decision === "submit" ? "You said Submit." : `You asked Claude to fix: ${review?.note ?? ""}`} Claude
          picks it up the next time it checks. If its chat was closed, tell Claude in Chrome to carry on.
        </p>
        {change}
      </div>
    );
  }
  if (run.status !== "review") return told || null;

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Check your answers below. Nothing has been sent yet.
        {run.review && run.review.round > 1 && ` (Round ${run.review.round})`}
      </p>
      {!fixing ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="gap-1.5"
            disabled={decide.isPending}
            onClick={() => {
              if (!dropFixes()) return;
              decide.mutate({ runId: run.id, decision: "submit" }, { onSuccess: () => setChanging(false) });
            }}
          >
            {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Submit
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => setFixing(true)}>
            <Wrench className="h-4 w-4" aria-hidden /> Fix something
          </Button>
          {!phone && (
            <Button
              variant="ghost"
              className="gap-1.5"
              disabled={decide.isPending}
              onClick={() => {
                if (!dropFixes()) return;
                decide.mutate({ runId: run.id, decision: "self" }, { onSuccess: () => setChanging(false) });
              }}
            >
              <MousePointerClick className="h-4 w-4" aria-hidden /> I'll submit it myself
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            aria-label="What should Claude fix?"
            placeholder="For example: my start date should be January, and say I'm open to hybrid."
            value={note}
            rows={3}
            maxLength={1900}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={!note.trim() || decide.isPending}
              onClick={() =>
                // The waiting fixes go with the typed note (the server adds them).
                decide.mutate(
                  { runId: run.id, decision: "fix", note: note.trim() },
                  { onSuccess: () => (setChanging(false), setFixing(false)) },
                )
              }
            >
              Send to Claude
            </Button>
            <Button variant="ghost" onClick={() => setFixing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {decide.isError && <p className="text-sm text-destructive">{(decide.error as Error).message}</p>}
      <p className="text-xs text-muted-foreground">
        You can also tell Claude in the chat, or in the Claude app on your phone.
      </p>
    </div>
  );
}

/** Every page's photos, folded away: the proof, not the list to check. */
function Photos({ run }: { run: ApplyRun }) {
  const [open, setOpen] = useState(false);
  const n = run.pages.reduce((sum, p) => sum + p.photo_ids.length, 0);
  if (!run.pages.length) return null;
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-medium"
      >
        Photos of each page{n ? ` (${n})` : ""}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t p-3">
          <Pages pages={run.pages} photosOnly />
        </div>
      )}
    </section>
  );
}

/**
 * The review (spec 026, built from the one sheet since spec 033): the
 * decision buttons, then what to check first (each question once), then every
 * answer grouped by step (one row per question), then the photos. Tap any
 * answer to change it or ask Claude; the fixes wait in the tray and go to
 * Claude together with Send fixes.
 */
export function ReviewBoard({ run }: { run: ApplyRun }) {
  const open = run.status === "review" && !run.review?.decision;
  const sheet = sheetOf(run);
  const first = checkRows(sheet);
  const fixer = useFixer(run);
  const steps = useOpenSteps(null);
  const tap = open ? fixer.open : undefined;

  return (
    <div className="space-y-4">
      <Review run={run} />
      {first.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Check these first</h3>
          <p className="text-xs text-muted-foreground">
            What Claude agreed to for you, what only you can answer, its guesses, and boxes left empty.
            {open && " Tap one to change it."}
          </p>
          <ul className="-mx-3 space-y-0.5" aria-label="Check these first">
            {first.map(({ step, row, k }) => (
              <li key={`${step.key}|${row.q}|${k}`}>
                <RowButton
                  row={row}
                  place={step.title}
                  fix={fixFor(run.fixes, step.key, row.q, k)}
                  onTap={
                    tap &&
                    (() =>
                      tap({ step: step.key, stepTitle: step.title, q: row.q, a: row.a, k, options: row.options, free: row.free }))
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet.steps.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Every answer</h3>
          <ol className="divide-y rounded-lg border">
            {sheet.steps.map((step) => (
              <StepGroup
                key={step.key}
                step={step}
                fixes={run.fixes}
                open={steps.isOpen(step.key)}
                onToggle={() => steps.toggle(step.key)}
                onTap={tap}
              />
            ))}
          </ol>
        </section>
      )}
      {open && <FixTray run={run} review />}
      <Photos run={run} />
      {fixer.sheet}
    </div>
  );
}
