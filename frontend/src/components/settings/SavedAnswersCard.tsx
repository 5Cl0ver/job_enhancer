import { useMemo, useState } from "react";
import { Brain, Check, Loader2, Search, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useCustomAnswers,
  useDeleteCustomAnswer,
  useSaveCustomAnswer,
  type CustomAnswer,
} from "@/hooks/useCustomAnswers";

/**
 * "Saved Answers" — the manager for the extension's learn-as-you-go memory.
 * Solves the edge case where it remembered something wrong: search, fix, or
 * delete any learned answer; changes sync to the extension.
 */
export function SavedAnswersCard() {
  const { data: answers = [], isLoading } = useCustomAnswers();
  const save = useSaveCustomAnswer();
  const del = useDeleteCustomAnswer();

  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return answers;
    return answers.filter(
      (a) =>
        a.question_text.toLowerCase().includes(needle) ||
        a.answer.toLowerCase().includes(needle),
    );
  }, [answers, q]);

  const onSave = (a: CustomAnswer) => {
    const next = edits[a.question_key];
    if (next == null || next === a.answer) return;
    save.mutate(
      { ...a, answer: next },
      {
        onSuccess: () => {
          setEdits((e) => {
            const { [a.question_key]: _drop, ...rest } = e;
            return rest;
          });
          setSavedKey(a.question_key);
          setTimeout(() => setSavedKey(null), 1500);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" /> Saved Answers
          {answers.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({answers.length})</span>
          )}
        </CardTitle>
        <CardDescription>
          Answers the extension learned as you applied — these auto-fill on future
          applications. Edit a typo or delete anything wrong; changes sync instantly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : answers.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            Nothing learned yet. When you apply and tap{" "}
            <span className="font-medium">“Remember my answers”</span> in the
            extension, your answers appear here.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search questions or answers…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <ul className="space-y-2.5">
              {filtered.map((a) => {
                const value = edits[a.question_key] ?? a.answer;
                const changed = value !== a.answer;
                const justSaved = savedKey === a.question_key;
                return (
                  <li key={a.question_key} className="rounded-lg border bg-card p-3">
                    <p className="mb-1.5 text-sm font-medium leading-snug">
                      {a.question_text}
                    </p>
                    <textarea
                      className="w-full min-h-[40px] resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      rows={1}
                      value={value}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [a.question_key]: e.target.value }))
                      }
                    />
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {justSaved ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <Check className="h-3.5 w-3.5" /> Saved
                          </span>
                        ) : changed ? (
                          "Unsaved change"
                        ) : (
                          ""
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {changed && (
                          <Button size="sm" onClick={() => onSave(a)} disabled={save.isPending}>
                            {save.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => del.mutate(a.question_key)}
                          disabled={del.isPending}
                        >
                          <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No answers match “{q}”.
                </li>
              )}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
