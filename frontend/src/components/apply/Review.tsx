import { useState } from "react";
import { Loader2, Send, Wrench, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerBubble, FixSheet, FixTray } from "@/components/apply/Bubbles";
import { Pages } from "@/components/apply/Pages";
import { useDecide, useMarkSent } from "@/hooks/useApply";
import { useIsPhone } from "@/hooks/useIsPhone";
import { type ApplyPage, type ApplyRun, type Fix, type PageAnswer, checkFirst, fixKey } from "@/lib/apply";

/**
 * The user's call before anything is sent: Submit (Claude presses it), Fix
 * something (Claude fixes and asks again), or I'll submit it myself (on the
 * computer: Job Catcher lifts its Submit block and notices the press).
 */
export function Review({ run, fixes = [] }: { run: ApplyRun; fixes?: Fix[] }) {
  const decide = useDecide();
  const sent = useMarkSent();
  const phone = useIsPhone();
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [changing, setChanging] = useState(false);
  const review = run.review;
  const decision = changing ? null : review?.decision;
  const pending = fixes.length;
  // Fixes the user marked but didn't send would be lost.
  const dropFixes = () =>
    !pending || window.confirm(`You have ${pending} fix${pending === 1 ? "" : "es"} not sent. Go on without them?`);
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
                // The typed note goes with any bubbles' fixes.
                decide.mutate(
                  { runId: run.id, decision: "fix", note: note.trim(), fixes },
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

/**
 * The review (spec 026): the decision buttons, then what to check first
 * (what Claude agreed to for you, its guesses, empty boxes), then every
 * page's photos and answers as bubbles. Tap a bubble to change it or ask
 * Claude about it; the fixes go to Claude together, and the review comes
 * back with them done.
 */
export function ReviewBoard({ run }: { run: ApplyRun }) {
  const decide = useDecide();
  const [fixes, setFixes] = useState<Map<string, Fix>>(new Map());
  const [target, setTarget] = useState<{ page: ApplyPage; answer: PageAnswer; i: number } | null>(null);
  const open = run.status === "review" && !run.review?.decision;
  const first = checkFirst(run.pages);
  const tap = open ? (page: ApplyPage, answer: PageAnswer, i: number) => setTarget({ page, answer, i }) : undefined;
  const key = target ? fixKey(target.page.n, target.i) : "";
  const send = () =>
    decide.mutate(
      { runId: run.id, decision: "fix", fixes: [...fixes.values()] },
      { onSuccess: () => setFixes(new Map()) },
    );

  return (
    <div className="space-y-4">
      <Review run={run} fixes={open ? [...fixes.values()] : []} />
      {first.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Check these first</h3>
          <p className="text-xs text-muted-foreground">
            What Claude agreed to for you, its best guesses, and boxes left empty.{open && " Tap one to change it."}
          </p>
          <ul className="space-y-2">
            {first.map(({ page, answer, i }) => (
              <li key={fixKey(page.n, i)}>
                <AnswerBubble
                  page={page}
                  answer={answer}
                  showPage
                  fix={fixes.get(fixKey(page.n, i))}
                  onTap={tap && (() => tap(page, answer, i))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <Pages pages={run.pages} openAll bubbles={{ fixes, onTap: tap }} />
      {open && (
        <FixTray count={fixes.size} sending={decide.isPending} onSend={send} onClear={() => setFixes(new Map())} />
      )}
      {decide.isError && <p className="text-sm text-destructive">Couldn't send the fixes. Try again.</p>}
      <FixSheet
        key={key}
        target={target}
        current={fixes.get(key)}
        onClose={() => setTarget(null)}
        onSave={(fix) => setFixes((m) => new Map(m).set(key, fix))}
        onRemove={() =>
          setFixes((m) => {
            const next = new Map(m);
            next.delete(key);
            return next;
          })
        }
      />
    </div>
  );
}
