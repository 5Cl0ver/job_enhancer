import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAnswerQuestions } from "@/hooks/useApply";
import { type ApplyQuestion, type ApplyRun, openBatch } from "@/lib/apply";

/** `touched`: the user changed it here, so a newer answer from the chat
 * never overwrites it (and an untouched one always follows the server). */
type Draft = { text: string; touched: boolean; from: string | null };

const draftOf = (q: ApplyQuestion): Draft => ({ text: q.answer ?? q.guess ?? "", touched: false, from: q.answer });

/** Facts only the user knows first, then Claude's order. */
const ordered = (qs: ApplyQuestion[]) => [...qs].sort((a, b) => Number(!!b.only_you) - Number(!!a.only_you));

/**
 * Claude's questions as one checklist (spec 030): each with Claude's best
 * guess filled in and a few quick answers. What only you can answer is
 * highlighted. Check them, change any, then one button sends them all.
 * Answers are kept as things told to Claude, so they never come back.
 */
export function Questions({ run }: { run: ApplyRun }) {
  const answer = useAnswerQuestions();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const open = run.status === "questions" && !run.answers_done;
  const list = ordered(openBatch(run.questions));

  // New questions get a draft; an untouched draft follows the server (an
  // answer the user gave Claude in the chat shows up here); typed ones stay.
  useEffect(() => {
    setDrafts((d) => {
      const next = { ...d };
      for (const q of run.questions) {
        const cur = next[q.id];
        if (!cur || (!cur.touched && cur.from !== q.answer)) next[q.id] = draftOf(q);
      }
      return next;
    });
  }, [run.questions]);

  const set = (q: ApplyQuestion, text: string) =>
    setDrafts((d) => ({ ...d, [q.id]: { ...(d[q.id] ?? draftOf(q)), text, touched: true } }));

  // Only what the user changed here, or left unanswered: an answer already
  // saved (from the chat, say) is never sent back as "skipped".
  const outgoing = list.flatMap((q) => {
    const d = drafts[q.id] ?? draftOf(q);
    if (!d.touched && q.answer) return [];
    const text = d.text.trim();
    return [text ? { id: q.id, answer: text } : { id: q.id, skipped: true }];
  });
  const empty = outgoing.filter((a) => "skipped" in a).length;
  const send = () => answer.mutate({ runId: run.id, done: true, answers: outgoing });

  if (!open) {
    return (
      <ul className="space-y-2">
        {run.questions.map((q) => (
          <li key={q.id} className="text-sm">
            <p className="font-medium">{q.question}</p>
            <p className="text-muted-foreground">
              {q.answer ?? "Skipped"}
              {q.source === "chat" && " (told Claude in the chat)"}
            </p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Claude filled in its best guesses. Check them, change any, then press go.
      </p>
      <ol className="space-y-2">
        {list.map((q) => {
          const d = drafts[q.id] ?? draftOf(q);
          const id = `q-${q.id}`;
          const guessed = !!q.guess && !d.touched && !q.answer && d.text === q.guess;
          return (
            <li
              key={q.id}
              className={cn(
                "space-y-2 rounded-xl border p-3",
                q.only_you && "border-amber-500/60 bg-amber-500/5",
              )}
            >
              {q.only_you && (
                <span className="inline-block rounded-full bg-amber-500/15 px-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Only you can answer
                </span>
              )}
              <p className="text-sm font-medium" id={id}>
                {q.question}
              </p>
              {q.why && <p className="text-xs text-muted-foreground">The listing says: “{q.why}”</p>}
              {!!q.choices?.length && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Quick answers for: ${q.question}`}>
                  {q.choices.map((c) => {
                    const on = d.text.trim() === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set(q, c)}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                        {c}
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                aria-labelledby={id}
                className="min-h-10"
                placeholder={q.only_you ? "Only you know this" : "Your answer (empty = skip)"}
                value={d.text}
                rows={1}
                maxLength={1900}
                onChange={(e) => set(q, e.target.value)}
              />
              {guessed && <p className="text-xs text-muted-foreground">Claude's best guess</p>}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button onClick={send} disabled={answer.isPending} className="gap-1.5">
          {answer.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Looks good, go
        </Button>
        {empty > 0 && (
          <p className="text-xs text-muted-foreground">
            {empty} left empty: Claude skips {empty === 1 ? "it" : "them"}.
          </p>
        )}
        {answer.isError && <p className="text-sm text-destructive">Couldn't send that. Try again.</p>}
      </div>
    </div>
  );
}
