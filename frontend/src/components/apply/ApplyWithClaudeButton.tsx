import { Link, useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BusyError, useJobApplyRuns, useStartApply } from "@/hooks/useApply";
import { isOpenApply } from "@/lib/apply";

/**
 * "Apply with Claude" on a saved job (spec 022): opens the job's application
 * page, where Claude's run shows live. A job with an application going opens
 * that one instead.
 */
export function ApplyWithClaudeButton({ savedJobId }: { savedJobId: string }) {
  const navigate = useNavigate();
  const start = useStartApply();
  const { data: runs = [] } = useJobApplyRuns(savedJobId);
  const going = runs.find(isOpenApply);
  const busy = start.error instanceof BusyError ? start.error : null;

  if (going) {
    return (
      <Button variant="outline" className="gap-1.5" onClick={() => navigate(`/apply/${going.id}`)}>
        <Sparkles className="h-4 w-4" aria-hidden /> Open application
      </Button>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={start.isPending}
        onClick={() => start.mutate(savedJobId, { onSuccess: (run) => navigate(`/apply/${run.id}`) })}
      >
        {start.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        Apply with Claude
      </Button>
      {busy && (
        <span className="text-xs text-muted-foreground">
          Another application is going.{" "}
          {busy.openRunId && (
            <Link className="underline" to={`/apply/${busy.openRunId}`}>
              Open it
            </Link>
          )}
        </span>
      )}
      {start.isError && !busy && <span className="text-xs text-destructive">Couldn't start. Try again.</span>}
    </span>
  );
}
