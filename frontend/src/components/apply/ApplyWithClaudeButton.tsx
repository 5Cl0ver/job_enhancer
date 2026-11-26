import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useResumes } from "@/hooks/useAI";
import { BusyError, useJobApplyRuns, useStartApply, useStopApply } from "@/hooks/useApply";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { isOpenApply } from "@/lib/apply";
import { cn } from "@/lib/utils";

type Choice = "new" | "job" | "other";

function Option({
  picked,
  onPick,
  title,
  detail,
  children,
}: {
  picked: boolean;
  onPick: () => void;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        picked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={picked}
        onClick={onPick}
        className="flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            picked && "border-primary bg-primary text-primary-foreground",
          )}
          aria-hidden
        >
          {picked && <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
      {picked && children && <div className="px-3 pb-3 pl-11">{children}</div>}
    </div>
  );
}

/**
 * "Apply with Claude" on a saved job (spec 022): opens the job's application
 * page, where Claude's run shows live. A job with an application going opens
 * that one instead. First it asks which résumé (spec 025): one Claude makes
 * for this job, the one already on the job, or another of yours, so Claude
 * only writes one when you want it to.
 */
export function ApplyWithClaudeButton({ savedJobId }: { savedJobId: string }) {
  const navigate = useNavigate();
  const start = useStartApply();
  const stop = useStopApply();
  const { data: runs = [] } = useJobApplyRuns(savedJobId);
  const { data: saved } = useSavedJobs();
  const { data: all = [] } = useResumes({ withMade: true });
  const [asking, setAsking] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [otherId, setOtherId] = useState("");
  const going = runs.find(isOpenApply);
  const busy = start.error instanceof BusyError ? start.error : null;

  const job = saved?.find((sj) => sj.id === savedJobId);
  const jobResumeId = (job as { resume_id?: string | null } | undefined)?.resume_id ?? null;
  const onJob = all.find((r) => r.id === jobResumeId) ?? null;
  // Your own résumés (never another job's made one).
  const yours = all.filter((r) => !r.document_id && r.id !== onJob?.id);
  const picked: Choice = choice ?? (onJob ? "job" : "new");
  const resumeId = picked === "job" ? onJob?.id : picked === "other" ? otherId || null : null;
  const ready = picked !== "other" || !!otherId;

  if (going) {
    return (
      <Button variant="outline" className="gap-1.5" onClick={() => navigate(`/apply/${going.id}`)}>
        <Sparkles className="h-4 w-4" aria-hidden /> Open application
      </Button>
    );
  }
  const go = () =>
    start.mutate(
      { savedJobId, resumeId },
      {
        onSuccess: (run) => {
          setAsking(false);
          navigate(`/apply/${run.id}`);
        },
      },
    );
  return (
    <span className="flex flex-col gap-1">
      <Button variant="outline" className="gap-1.5" onClick={() => setAsking(true)}>
        <Sparkles className="h-4 w-4" aria-hidden />
        Apply with Claude
      </Button>
      <Dialog open={asking} onOpenChange={(o) => !start.isPending && setAsking(o)}>
        <DialogContent className="max-h-[95dvh] max-w-md overflow-y-auto">
          <DialogTitle>Which résumé?</DialogTitle>
          <DialogDescription>Job Catcher attaches it to the application.</DialogDescription>
          <div role="radiogroup" aria-label="Which résumé" className="space-y-2">
            <Option
              picked={picked === "new"}
              onPick={() => setChoice("new")}
              title="Make one for this job"
              detail="Claude asks about anything missing, writes it, and you look it over."
            />
            {onJob && (
              <Option
                picked={picked === "job"}
                onPick={() => setChoice("job")}
                title="Use the one on this job"
                detail={onJob.filename}
              />
            )}
            {yours.length > 0 && (
              <Option
                picked={picked === "other"}
                onPick={() => setChoice("other")}
                title="Use another résumé"
                detail="Pick one of yours."
              >
                <select
                  aria-label="Your résumés"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base"
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {yours.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.filename}
                    </option>
                  ))}
                </select>
              </Option>
            )}
          </div>
          {picked !== "new" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Claude skips the questions and goes straight to the application.
            </p>
          )}
          <Button className="w-full gap-1.5" disabled={!ready || start.isPending} onClick={go}>
            {start.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            Start
          </Button>
          {busy && (
            <div role="alert" className="space-y-2 rounded-md border px-3 py-2 text-sm">
              <p>
                {busy.title
                  ? `Claude is applying to ${busy.title}${busy.company ? ` at ${busy.company}` : ""}.`
                  : "Another application is going."}{" "}
                One at a time.
              </p>
              {busy.openRunId && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/apply/${busy.openRunId}`}>Open it</Link>
                  </Button>
                  <Button
                    size="sm"
                    disabled={stop.isPending || start.isPending}
                    onClick={() => stop.mutate(busy.openRunId as string, { onSuccess: go })}
                  >
                    {stop.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Stop it and start this one
                  </Button>
                </div>
              )}
              {stop.isError && <p className="text-xs text-destructive">Couldn't stop it. Try again.</p>}
            </div>
          )}
          {start.isError && !busy && <p className="text-xs text-destructive">Couldn't start. Try again.</p>}
        </DialogContent>
      </Dialog>
    </span>
  );
}
