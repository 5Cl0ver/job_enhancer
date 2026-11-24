import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, ChevronLeft, Loader2, PenLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResumeStep } from "@/components/onboarding/ResumeStep";
import { JobCatcherStep } from "@/components/onboarding/JobCatcherStep";
import { ExtrasStep } from "@/components/onboarding/ExtrasStep";
import { useOnboarding, useUpdateOnboarding } from "@/hooks/useOnboarding";
import { cn } from "@/lib/utils";

const TITLES = ["", "Your résumé", "Get Job Catcher", "Optional extras", "You're ready"];
const LAST = 4;

/**
 * The Welcome (spec 019 part B, contracts/ui.md): hello, then résumé → Job
 * Catcher → optional extras → done, one short screen each. "Skip, do it
 * later" is always there and nothing is lost: progress is kept on the
 * account, and Getting started keeps track of what's left. `?step=1` opens a
 * step directly (the checklist's "Add your résumé").
 */
export default function WelcomePage() {
  const { data, isLoading, isError, refetch } = useOnboarding();
  const update = useUpdateOnboarding();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const asked = Number(params.get("step"));
  const [step, setStep] = useState<number | null>(
    Number.isInteger(asked) && asked >= 1 && asked <= LAST ? asked : null,
  );

  // Pick up where they left off (on any device).
  useEffect(() => {
    if (step === null && data) setStep(data.welcome.done ? 0 : Math.min(data.welcome.step, LAST - 1));
  }, [step, data]);

  const go = (next: number) => {
    setStep(next);
    if (next === LAST) update.mutate({ welcome_step: LAST, welcome_done: true });
    else if (next > (data?.welcome.step ?? 0)) update.mutate({ welcome_step: next });
    window.scrollTo?.(0, 0);
  };

  // Into the app only once it's saved, so the front door doesn't send them back.
  const skip = () =>
    update.mutate(
      { welcome_done: true },
      { onSuccess: () => navigate("/"), onError: () => navigate("/search") },
    );

  if (isError && step === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load your setup. Check your connection.</p>
        <div className="flex gap-2">
          <Button onClick={() => refetch()}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate("/search")}>
            Skip, do it later
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || step === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="font-semibold">Job Enhancer</span>
        {step < LAST && (
          <Button variant="ghost" size="sm" onClick={skip} disabled={update.isPending}>
            Skip, do it later
          </Button>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-10 pt-4">
        {step > 0 && (
          <div className="flex items-center gap-3">
            {step > 1 && step < LAST && (
              <Button variant="ghost" size="icon" onClick={() => setStep(step - 1)} aria-label="Back">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <ol className="flex gap-1.5" aria-label={`Step ${step} of ${LAST}`}>
              {[1, 2, 3, 4].map((n) => (
                <li
                  key={n}
                  aria-current={n === step ? "step" : undefined}
                  className={cn("h-2 w-8 rounded-full", n <= step ? "bg-primary" : "bg-muted")}
                />
              ))}
            </ol>
            <span className="text-xs text-muted-foreground">
              {step} of {LAST}
            </span>
          </div>
        )}
        {step > 0 && <h1 className="text-2xl font-bold tracking-tight">{TITLES[step]}</h1>}

        {step === 0 && <Hello onStart={() => go(1)} />}
        {step === 1 && <ResumeStep onDone={() => go(2)} />}
        {step === 2 && <JobCatcherStep onNext={() => go(3)} />}
        {step === 3 && <ExtrasStep onNext={() => go(4)} />}
        {step === LAST && <Done />}
      </main>
    </div>
  );
}

function Hello({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Job Enhancer</h1>
        <p className="text-muted-foreground">
          Find jobs, keep them in one place, and fill applications in seconds.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {[
          { icon: Search, title: "Find", text: "Search jobs from many sites at once." },
          { icon: Briefcase, title: "Track", text: "Every job you save, and where each application stands." },
          { icon: PenLine, title: "Fill", text: "Job Catcher fills applications for you." },
        ].map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3 rounded-lg border p-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm">
              <b className="font-medium">{title}.</b> {text}
            </p>
          </li>
        ))}
      </ul>
      <Button size="lg" onClick={onStart}>
        Let's set you up (about 3 minutes)
      </Button>
    </div>
  );
}

function Done() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">Here's where to start.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild size="lg" className="gap-2">
          <Link to="/search">
            <Search className="h-4 w-4" aria-hidden /> Find jobs
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="gap-2">
          <Link to="/jobs">
            <Briefcase className="h-4 w-4" aria-hidden /> My jobs
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Your Getting started list keeps track of what's left.</p>
    </div>
  );
}
