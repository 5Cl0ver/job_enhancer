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
  const [changing, setChanging] = useState(false);
  const review = run.review;
  const decision = changing ? null : review?.decision;
  // What the user told Claude in a chat, in their own words (spec 022).
  const told = review?.by === "chat" && review.words && (
    <p className="text-sm">
      You told Claude: <q className="italic">{review.words}</q>
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
        Check every page's photos and answers below. Nothing has been sent yet.
        {run.review && run.review.round > 1 && ` (Round ${run.review.round})`}
      </p>
      {!fixing ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="gap-1.5"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ runId: run.id, decision: "submit" }, { onSuccess: () => setChanging(false) })}
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
              onClick={() => decide.mutate({ runId: run.id, decision: "self" }, { onSuccess: () => setChanging(false) })}
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
