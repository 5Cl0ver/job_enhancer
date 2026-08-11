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
 * The edge case this solves: it remembered something you typed wrong. Here you
 * can search, fix, or delete any learned answer; changes sync to the extension.
 */
export function SavedAnswersCard() {
  const { data: answers = [], isLoading } = useCustomAnswers();
  const save = useSaveCustomAnswer();
  const del = useDeleteCustomAnswer();

  const [q, setQ] = useState("");
  // Local edits keyed by question_key; a row shows "Save" only when changed.
  const [edits, setEdits] = useState<Record<string, string>>({});

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
        onSuccess: () =>
          setEdits((e) => {
            const { [a.question_key]: _drop, ...rest } = e;
            return rest;
          }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" /> Saved Answers
          {answers.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({answers.length})
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Answers the extension learned as you applied. Fix a typo or delete
          anything wrong — changes sync to the extension automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : answers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing learned yet. As you apply and hit{" "}
            <span className="font-medium">“Remember my answers”</span> in the
            extension, your answers show up here.
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

            <ul className="divide-y rounded-md border">
              {filtered.map((a) => {
                const value = edits[a.question_key] ?? a.answer;
                const changed = value !== a.answer;
                return (
                  <li key={a.question_key} className="space-y-1.5 p-3">
                    <p className="text-sm font-medium">{a.question_text}</p>
                    <div className="flex items-center gap-2">
                      <Input
                        value={value}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [a.question_key]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && onSave(a)}
                      />
                      {changed && (
                        <Button
                          size="sm"
                          onClick={() => onSave(a)}
                          disabled={save.isPending}
                        >
                          {save.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => del.mutate(a.question_key)}
                        disabled={del.isPending}
                        aria-label="Delete answer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="p-4 text-center text-sm text-muted-foreground">
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
