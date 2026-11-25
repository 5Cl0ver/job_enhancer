import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Copy, Hand, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApplySteps } from "@/components/apply/ApplySteps";
import { Pages } from "@/components/apply/Pages";
import { Questions } from "@/components/apply/Questions";
import { ResumeForJob } from "@/components/apply/ResumeForJob";
import { Review } from "@/components/apply/Review";
import { useApplyRun, useHelpDone, useStopApply } from "@/hooks/useApply";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import {
  APPLY_LINE,
  type ApplyRun,
  currentStep,
  HELP_TITLES,
  isOpenApply,
  needsYou,
  statusLine,
} from "@/lib/apply";

function Card({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "you" | "done";
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border p-4",
        tone === "you" && "border-primary/50 bg-primary/5",
        tone === "done" && "border-emerald-500/40 bg-emerald-500/5",
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function StartCard({ run }: { run: ApplyRun }) {
  const [copied, setCopied] = useState(false);
  const phone = useIsPhone();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(APPLY_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the line is on screen to copy by hand.
    }
  };
  if (run.status !== "waiting") return null;
  return (
    <Card title="Start Claude" tone="you">
      {phone && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          This part happens on your computer, in Chrome. Everything after it works here too.
        </p>
      )}
      <p className="text-sm">Open the Claude side panel in Chrome and say:</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm">{APPLY_LINE}</code>
        <Button variant="secondary" className="gap-1.5" onClick={copy}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Keep Job Catcher on and signed in: it takes a photo of every page and fills what it knows.</li>
        <li>Claude asks you a few questions, writes a full résumé for this job, and fills the application.</li>
        <li>Nothing is sent until you check the photos and say Submit.</li>
      </ul>
    </Card>
  );
}

function HelpCard({ run }: { run: ApplyRun }) {
  const done = useHelpDone();
  if (run.status !== "needs_you" || !run.help || run.help.done_at) return null;
  return (
    <Card title={HELP_TITLES[run.help.kind] ?? "Claude needs you"} tone="you">
      <p className="flex gap-2 text-sm">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        {run.help.what}
      </p>
      {(run.help.kind === "sign_up" || run.help.kind === "sign_in") && (
        <p className="text-xs text-muted-foreground">
          Make or type the password yourself: Chrome offers a strong one and saves it for you. Job Enhancer
          never sees or stores your passwords.
        </p>
      )}
      <Button onClick={() => done.mutate(run.id)} disabled={done.isPending}>
        Done, keep going
      </Button>
      {done.isError && <p className="text-sm text-destructive">{(done.error as Error).message}</p>}
    </Card>
  );
}

function Activity({ run }: { run: ApplyRun }) {
  const [open, setOpen] = useState(false);
  if (!run.events.length) return null;
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-medium"
      >
        What happened ({run.events.length})
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ol className="space-y-1 border-t px-4 py-3 text-sm">
          {[...run.events].reverse().map((e, i) => (
            <li key={i} className="flex gap-3">
              <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={e.at}>
                {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </time>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One application with Claude (spec 022): the six steps, live, on phone or
 * computer. Each part shows once it has something; the part waiting for the
 * user is framed and comes first.
 */
export function ApplyRunPage() {
  const { runId } = useParams();
  const { data: run, isLoading, isError } = useApplyRun(runId);
  const stop = useStopApply();

  if (isLoading) return <Skeleton className="mx-auto h-64 max-w-3xl" />;
  // A failed poll keeps what's on screen (and anything typed): only a page
  // that never loaded shows the error.
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
        Couldn't load this application.
      </div>
    );
  }

  const step = currentStep(run);
  const open = isOpenApply(run);
  const job = [run.job.title, run.job.company].filter(Boolean).join(" at ");
  const reviewing = run.status === "review";

  return (
    <div className="container mx-auto max-w-3xl space-y-4 md:px-4 md:py-6">
      <Link
        to={`/jobs/${run.job.listing_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the job
      </Link>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Apply with Claude</h1>
          <p className="truncate text-sm text-muted-foreground">{job}</p>
          <p className="flex items-center gap-1.5 text-sm font-medium" aria-live="polite">
            {open && !needsYou(run) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {run.status === "sent" && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />}
            {statusLine(run)}
          </p>
        </div>
        {open && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 self-start"
            disabled={stop.isPending}
            onClick={() => {
              if (window.confirm("Stop this application? Claude stops, and nothing more is sent.")) stop.mutate(run.id);
            }}
          >
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop
          </Button>
        )}
      </header>
      {stop.isError && <p className="text-sm text-destructive">Couldn't stop it. Try again.</p>}

      {isError && (
        <p className="text-xs text-muted-foreground" role="status">
          Reconnecting…
        </p>
      )}

      <ApplySteps step={step} ended={!open} sent={run.status === "sent"} />

      <StartCard run={run} />
      <HelpCard run={run} />

      {reviewing && (
        <Card title="Your review" tone={run.review?.decision ? undefined : "you"}>
          <Review run={run} />
          <Pages pages={run.pages} openAll />
        </Card>
      )}

      {run.questions.length > 0 && (
        <Card title="Questions" tone={run.status === "questions" && !run.answers_done ? "you" : undefined}>
          <Questions run={run} />
        </Card>
      )}

      {run.resume_id && (
        <Card title="Résumé for this job">
          <ResumeForJob run={run} />
        </Card>
      )}

      {!reviewing && run.pages.length > 0 && (
        <Card title={run.status === "sent" ? "What you sent" : "Application"}>
          <Pages pages={run.pages} />
        </Card>
      )}

      {run.status === "sent" && (
        <Card title="Sent" tone="done">
          <p className="text-sm">Your job is in Applied. The photos stay here for 30 days; the answers stay with the job.</p>
        </Card>
      )}

      <Activity run={run} />
    </div>
  );
}
