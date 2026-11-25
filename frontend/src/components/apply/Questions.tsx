import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAnswerQuestions } from "@/hooks/useApply";
import type { ApplyQuestion, ApplyRun } from "@/lib/apply";

/** `touched`: the user changed it here, so a newer answer from the chat
 * never overwrites it (and an untouched one always follows the server). */
type Draft = { yes: boolean | null; details: string; skipped: boolean; touched: boolean; from: string | null };

/** A saved answer back into Yes/No + details ("No. Never used it"). */
function draftOf(q: ApplyQuestion): Draft {
  const a = q.answer ?? "";
  const m = a.match(/^(yes|no)\b[.,:]?\s*(.*)$/is);
  const yes = m ? m[1].toLowerCase() === "yes" : null;
  return { yes, details: m ? m[2] : a, skipped: q.skipped, touched: false, from: q.answer };
}

/** "Yes. Moved 200 laptops to Intune at Logical Position." */
function answerOf(d: Draft): string {
  const said = d.details.trim();
  if (d.yes === false) return said ? `No. ${said}` : "No";
  if (d.yes === true) return said && !/^yes\b/i.test(said) ? `Yes. ${said}` : said || "Yes";
  return said;
}

/**
 * Claude's questions about what the listing wants that the résumé doesn't
 * show. Yes / No plus a details box each; any can be skipped. "Done, make my
 * résumé" sends them all. Answers are kept as things told to Claude, so the
 * same question never comes back for a later job.
 */
export function Questions({ run }: { run: ApplyRun }) {
  const answer = useAnswerQuestions();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const open = run.status === "questions" && !run.answers_done;

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

  const set = (q: ApplyQuestion, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [q.id]: { ...(d[q.id] ?? draftOf(q)), ...patch, touched: true } }));

  // Only what the user changed here, or left unanswered: an answer already
  // saved (from the chat, say) is never sent back as "skipped".
  const outgoing = run.questions.flatMap((q) => {
    const d = drafts[q.id] ?? draftOf(q);
    if (!d.touched && q.answer) return [];
    const text = answerOf(d);
    return [d.skipped || !text ? { id: q.id, skipped: true } : { id: q.id, answer: text }];
  });
  const skipping = outgoing.filter((a) => "skipped" in a).length;
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your answers help Claude write a résumé that shows what this job wants, and only what's true. You can
        also answer Claude in the chat.
      </p>
      <ol className="space-y-3">
        {run.questions.map((q, i) => {
          const d = drafts[q.id] ?? draftOf(q);
          return (
            <li key={q.id} className={cn("space-y-2 rounded-lg border p-3", d.skipped && "opacity-60")}>
              <p className="text-sm font-medium" id={`q-${q.id}`}>
                {i + 1}. {q.question}
              </p>
              {q.why && <p className="text-xs text-muted-foreground">The listing says: “{q.why}”</p>}
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`q-${q.id}`}>
                {[
                  { label: "Yes", value: true },
                  { label: "No", value: false },
                ].map((o) => (
                  <Button
                    key={o.label}
                    type="button"
                    size="sm"
                    variant={d.yes === o.value && !d.skipped ? "default" : "outline"}
                    aria-pressed={d.yes === o.value && !d.skipped}
                    onClick={() => set(q, { yes: o.value, skipped: false })}
                  >
                    {o.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={d.skipped}
                  onClick={() => set(q, { skipped: !d.skipped })}
                >
                  {d.skipped ? "Skipped" : "Skip"}
                </Button>
              </div>
              {!d.skipped && (
                <Textarea
                  aria-label={`Details for: ${q.question}`}
                  placeholder={d.yes === false ? "Anything close? (optional)" : "Where, and what did you do with it?"}
                  value={d.details}
                  rows={2}
                  maxLength={1900}
                  onChange={(e) => set(q, { details: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button onClick={send} disabled={answer.isPending} className="gap-1.5">
          {answer.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Done, make my résumé
        </Button>
        {skipping > 0 && (
          <p className="text-xs text-muted-foreground">
            {skipping} unanswered will be skipped.
          </p>
        )}
        {answer.isError && <p className="text-sm text-destructive">Couldn't send that. Try again.</p>}
      </div>
    </div>
  );
}
