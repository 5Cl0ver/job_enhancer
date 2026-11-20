import { useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";

import { errorText } from "@/components/scout/errorText";
import { useChangeInstruction, useInstructionHistory } from "@/hooks/useScout";
import type { InstructionSection } from "@/lib/scout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_TEXT = 8000;
const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * One editable section of what Claude is told: a text, the scoring weights or
 * the limits. Save, Reset to original, and earlier versions to restore.
 */
export function InstructionEditor({ section }: { section: InstructionSection }) {
  if (section.kind === "text") return <TextEditor section={section} />;
  return <NumbersEditor section={section} />;
}

function TextEditor({ section }: { section: InstructionSection }) {
  const current = section.current as string;
  const [text, setText] = useState(current);
  const change = useChangeInstruction();
  const dirty = text.trim() !== current.trim();
  const id = `instr-${section.key}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        {section.title}
      </Label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        maxLength={MAX_TEXT}
        spellCheck={false}
        className="font-mono text-xs leading-relaxed"
      />
      <p className="text-right text-xs text-muted-foreground">
        {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}
      </p>
      <Actions
        section={section}
        dirty={dirty}
        pending={change.isPending}
        error={change.isError ? errorText(change.error, "Couldn't save.") : null}
        onSave={() => change.mutate({ key: section.key, text })}
        onReset={async () => {
          const out = await change.mutateAsync({ key: section.key, reset: true });
          setText(out.current as string);
        }}
        onRestore={async (versionId) => {
          const out = await change.mutateAsync({
            key: section.key,
            restore: versionId,
          });
          setText(out.current as string);
        }}
      />
    </div>
  );
}

function NumbersEditor({ section }: { section: InstructionSection }) {
  const current = section.current as Record<string, number>;
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(current).map(([k, v]) => [k, String(v)])),
  );
  const change = useChangeInstruction();
  const numbers = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, Number(v)]),
  );
  const isRubric = section.kind === "rubric";
  const total = Object.values(numbers).reduce((a, b) => a + (b || 0), 0);
  const dirty = Object.keys(current).some((k) => numbers[k] !== current[k]);
  const outOfRange = Object.values(numbers).some(
    (n) => !Number.isInteger(n) || n < 0 || n > 10,
  );
  const problem = isRubric
    ? outOfRange
      ? "Each part is a whole number from 0 to 10."
      : total !== 10
        ? `The parts must add up to 10 (now ${total}).`
        : null
    : Object.entries(section.ranges ?? {}).find(
          ([k, [lo, hi]]) =>
            !Number.isInteger(numbers[k]) || numbers[k] < lo || numbers[k] > hi,
        )
      ? "Each limit has to stay within its range."
      : null;
  const fill = (next: Record<string, number>) =>
    setValues(
      Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])),
    );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(current).map((k) => {
          const id = `instr-${section.key}-${k}`;
          const range = section.ranges?.[k];
          return (
            <div key={k} className="space-y-1">
              <Label htmlFor={id} className="text-sm font-normal">
                {section.labels?.[k] ?? k}
                {range && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({range[0]}–{range[1]})
                  </span>
                )}
              </Label>
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={range?.[0] ?? 0}
                max={range?.[1] ?? 10}
                value={values[k]}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </div>
          );
        })}
      </div>
      {isRubric && (
        <p
          className={
            problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
          aria-live="polite"
        >
          Total: {total} of 10
          {outOfRange && " · each part is 0 to 10"}
        </p>
      )}
      {problem && dirty && !isRubric && (
        <p className="text-xs text-destructive">{problem}</p>
      )}
      <Actions
        section={section}
        dirty={dirty}
        blocked={!!problem}
        pending={change.isPending}
        error={change.isError ? errorText(change.error, "Couldn't save.") : null}
        onSave={() => change.mutate({ key: section.key, values: numbers })}
        onReset={async () => {
          const out = await change.mutateAsync({ key: section.key, reset: true });
          fill(out.current as Record<string, number>);
        }}
        onRestore={async (versionId) => {
          const out = await change.mutateAsync({
            key: section.key,
            restore: versionId,
          });
          fill(out.current as Record<string, number>);
        }}
      />
    </div>
  );
}

function Actions({
  section,
  dirty,
  blocked = false,
  pending,
  error,
  onSave,
  onReset,
  onRestore,
}: {
  section: InstructionSection;
  dirty: boolean;
  blocked?: boolean;
  pending: boolean;
  error: string | null;
  onSave: () => void;
  onReset: () => Promise<void>;
  onRestore: (versionId: string) => Promise<void>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const safe = (fn: () => Promise<void>) => () => {
    fn().catch(() => {
      // shown below
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={!dirty || blocked || pending}
          onClick={onSave}
        >
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save
        </Button>
        {section.edited && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 pointer-coarse:min-h-11"
            disabled={pending}
            onClick={safe(onReset)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset to original
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 pointer-coarse:min-h-11"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((s) => !s)}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          History
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {showHistory && (
        <VersionList
          section={section}
          pending={pending}
          onRestore={(id) => safe(() => onRestore(id))()}
        />
      )}
    </div>
  );
}

function VersionList({
  section,
  pending,
  onRestore,
}: {
  section: InstructionSection;
  pending: boolean;
  onRestore: (versionId: string) => void;
}) {
  const { data: versions, isLoading } = useInstructionHistory(section.key, true);
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!versions?.length)
    return (
      <p className="text-xs text-muted-foreground">
        No changes yet: this is the original.
      </p>
    );
  return (
    <ul className="divide-y rounded-md border text-xs" aria-label="Earlier versions">
      {versions.map((v, i) => (
        <li key={v.id} className="flex flex-col gap-1.5 p-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {new Date(v.created_at).toLocaleString(undefined, WHEN)}
              {i === 0 && " · current"}
              {v.reset && " · reset to original"}
            </p>
            {!v.reset && (
              <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                {typeof v.body === "string"
                  ? v.body
                  : Object.entries(v.body)
                      .map(([k, n]) => `${section.labels?.[k] ?? k} ${n}`)
                      .join(" · ")}
              </p>
            )}
          </div>
          {i > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 pointer-coarse:h-11"
              disabled={pending}
              onClick={() => onRestore(v.id)}
            >
              Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
