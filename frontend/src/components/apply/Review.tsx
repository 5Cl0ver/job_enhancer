import { useState } from "react";
import { Loader2, Send, Wrench, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDecide, useMarkSent } from "@/hooks/useApply";
import { useIsPhone } from "@/hooks/useIsPhone";
import type { ApplyRun } from "@/lib/apply";

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
  const decision = run.review?.decision;

  if (run.status === "review" && decision === "self") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          Go to the application's tab and press its <strong>Submit</strong> button. Job Catcher notices and
          moves the job to Applied.
        </p>
        <Button variant="outline" onClick={() => sent.mutate(run.id)} disabled={sent.isPending}>
          I sent it
        </Button>
      </div>
    );
  }
  if (run.status !== "review" || decision) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Check every page's photos and answers below. Nothing has been sent yet.
        {run.review && run.review.round > 1 && ` (Round ${run.review.round})`}
      </p>
      {!fixing ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="gap-1.5"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ runId: run.id, decision: "submit" })}
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
              onClick={() => decide.mutate({ runId: run.id, decision: "self" })}
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
              onClick={() => decide.mutate({ runId: run.id, decision: "fix", note: note.trim() })}
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
