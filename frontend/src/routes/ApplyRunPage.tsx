import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronDown, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApplySteps } from "@/components/apply/ApplySteps";
import { Pages } from "@/components/apply/Pages";
import { Problems } from "@/components/apply/Problems";
import { Questions } from "@/components/apply/Questions";
import { ResumeForJob } from "@/components/apply/ResumeForJob";
import { JobCoverLetterPicker, letterFileName } from "@/components/jobs/JobCoverLetterPicker";
import { documentFile, useFileViewer } from "@/components/common/FileViewer";
import { ResumeReview } from "@/components/apply/ResumeReview";
import { ModeSwitch } from "@/components/apply/ModeSwitch";
import { ReviewBoard } from "@/components/apply/Review";
import { StepCheck } from "@/components/apply/StepCheck";
import { YourApplication } from "@/components/apply/YourApplication";
import {
  Conversation,
  CopyLine,
  DidItGo,
  HelpCard,
  Readiness,
  ScreenNow,
  SentCard,
  Stopped,
} from "@/components/apply/Remote";
import { useApplyRun, useStopApply } from "@/hooks/useApply";
import { API_BASE } from "@/lib/api";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import {
  applyLine,
  type ApplyRun,
  currentStep,
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
  const phone = useIsPhone();
  if (run.status !== "waiting") return null;
  return (
    <Card title="Start Claude" tone="you">
      {phone && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          This part happens on your computer, in Chrome. Everything after it works here too.
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-medium">How should Claude go?</p>
        <ModeSwitch run={run} explain />
      </div>
      <p className="text-sm">Open the Claude side panel in Chrome and say:</p>
      <CopyLine line={applyLine(run)} />
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Keep Job Catcher on and signed in: it takes a photo of every page and fills what it knows.</li>
        <li>
          {run.resume_picked
            ? "Claude uses the résumé you picked and fills the application."
            : "Claude asks you a few questions, writes a résumé for this job (you look it over), and fills the application."}
        </li>
        <li>Then follow along here, on your phone if you like: answer Claude, message it, see the screen.</li>
        <li>Nothing is sent until you check the photos and say Submit.</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Using another AI that can browse and use connectors? Connect it to{" "}
        <code className="break-all">{`${API_BASE.replace(/\/+$/, "")}/mcp`}</code> and say the same line.
      </p>
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

/** "Claude wrote a cover letter. View" under the run's status (spec 039). */
function LetterNote({ run }: { run: ApplyRun }) {
  const { view, viewer } = useFileViewer();
  if (!run.cover_letter_written || !run.cover_letter) return null;
  const letter = run.cover_letter;
  return (
    <p className="text-sm text-muted-foreground">
      Claude wrote a cover letter.{" "}
      <button
        type="button"
        className="font-medium text-primary underline-offset-2 hover:underline"
        onClick={() => view(documentFile(letter.id, letterFileName(run.job.company)))}
      >
        View
      </button>
      {viewer}
    </p>
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
  const asking = run.status === "questions" && !run.answers_done;
  const checking = run.status === "resume_review";

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
          <LetterNote run={run} />
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
      <Readiness run={run} open={open} />

      <Stopped run={run} />
      <StartCard run={run} />
      <HelpCard key={run.help?.at ?? "none"} run={run} />
      <DidItGo run={run} />
      <StepCheck run={run} />

      {/* Claude's open questions are what it's waiting for: first. */}
      {asking && (
        <Card title="Claude's questions" tone="you">
          <Questions run={run} />
        </Card>
      )}

      {checking && (
        <Card title="Look over your résumé" tone={run.resume_check?.decision ? undefined : "you"}>
          <ResumeReview run={run} />
        </Card>
      )}

      {reviewing && (
        <Card title="Your review" tone={run.review?.decision ? undefined : "you"}>
          <ReviewBoard run={run} />
        </Card>
      )}

      {!reviewing && <YourApplication run={run} />}
      <Conversation run={run} open={open} />
      <ScreenNow run={run} open={open} />

      {!asking && run.questions.length > 0 && (
        <Card title="Questions">
          <Questions run={run} />
        </Card>
      )}

      {run.resume_id && !checking && (
        <Card title="Résumé for this job">
          <ResumeForJob run={run} />
        </Card>
      )}

      {/* Right by the résumé, the same row as on the job's page (spec 039). */}
      {(run.cover_letter || run.cover_letter_written) && (
        <Card title="Cover letter">
          <JobCoverLetterPicker
            jobListingId={run.job.listing_id}
            company={run.job.company}
            letter={run.cover_letter ?? null}
            bare
          />
        </Card>
      )}

      {!reviewing && run.pages.some((p) => p.photo_ids.length || p.photo === "waiting") && (
        <Card title="Photos of each page">
          <Pages pages={run.pages} photosOnly />
        </Card>
      )}

      <SentCard run={run} />

      <Problems problems={run.problems} />
      <Activity run={run} />
    </div>
  );
}
