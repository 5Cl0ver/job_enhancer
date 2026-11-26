import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type BugDraft,
  type BugSection,
  type BugSeverity,
  SECTIONS,
  SECTION_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  STEP_MAX,
  STEPS_MAX,
  stepsCheck,
} from "@/lib/bugs";
import { cn } from "@/lib/utils";

export const EMPTY_DRAFT: BugDraft = {
  type: "bug",
  title: "",
  section: "app",
  severity: "major",
  actual: "",
  expected: "",
  steps: "",
};

const SEG = "min-h-9 flex-1 rounded-md px-3 text-sm pointer-coarse:min-h-11";

/** A row of buttons that act as one choice (Bug / Idea, the severity). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex gap-1 rounded-lg bg-muted p-1"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            SEG,
            value === o.value
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The one format, as the owner types it: the add form and the edit form. */
export function BugForm({
  draft,
  onChange,
  idPrefix,
}: {
  draft: BugDraft;
  onChange: (d: BugDraft) => void;
  idPrefix: string;
}) {
  const set = <K extends keyof BugDraft>(k: K, v: BugDraft[K]) =>
    onChange({ ...draft, [k]: v });
  const bug = draft.type === "bug";
  const id = (name: string) => `${idPrefix}-${name}`;
  // Steps are optional: one tap away, so the form stays short.
  const [stepsOpen, setShowSteps] = useState(false);
  const showSteps = stepsOpen || !!draft.steps;
  const check = stepsCheck(draft.steps);
  return (
    <div className="grid gap-3">
      <Segmented
        label="Bug or idea"
        value={draft.type}
        options={[
          { value: "bug", label: "Bug" },
          { value: "idea", label: "Idea" },
        ]}
        onChange={(v) => set("type", v)}
      />
      <div className="grid gap-1.5">
        <Label htmlFor={id("title")}>Title</Label>
        <Input
          id={id("title")}
          value={draft.title}
          maxLength={140}
          required
          placeholder={
            bug ? "Save does nothing on a phone" : "Show salary on every card"
          }
          onChange={(e) => set("title", e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("actual")}>
          {bug ? "What happened" : "The idea"}
        </Label>
        <Textarea
          id={id("actual")}
          value={draft.actual}
          maxLength={2000}
          rows={3}
          onChange={(e) => set("actual", e.target.value)}
        />
      </div>
      {bug && (
        <div className="grid gap-1.5">
          <Label htmlFor={id("expected")}>What you expected</Label>
          <Textarea
            id={id("expected")}
            value={draft.expected}
            maxLength={1000}
            rows={2}
            onChange={(e) => set("expected", e.target.value)}
          />
        </div>
      )}
      {showSteps ? (
        <div className="grid gap-1.5">
          <Label htmlFor={id("steps")}>
            Steps{" "}
            <span className="font-normal text-muted-foreground">
              (one a line)
            </span>
          </Label>
          <Textarea
            id={id("steps")}
            value={draft.steps}
            rows={2}
            autoFocus={!draft.steps}
            onChange={(e) => set("steps", e.target.value)}
            aria-describedby={id("steps-note")}
            aria-invalid={check.tooLong !== null}
          />
          <p
            id={id("steps-note")}
            className={cn(
              "text-xs",
              check.tooLong !== null
                ? "text-destructive"
                : check.tooMany
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground",
            )}
          >
            {check.tooLong !== null
              ? `Step ${check.tooLong} is over ${STEP_MAX} characters. Make it shorter or split it.`
              : check.tooMany
                ? `Only the first ${STEPS_MAX} steps are kept.`
                : `Up to ${STEPS_MAX} steps, ${STEP_MAX} characters each.`}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowSteps(true)}
          className="justify-self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          + Add steps
        </button>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={id("section")}>Section</Label>
        <select
          id={id("section")}
          value={draft.section}
          onChange={(e) => set("section", e.target.value as BugSection)}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm pointer-coarse:h-11 dark:bg-input/30"
        >
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {bug && (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium leading-none">Severity</span>
          <Segmented
            label="Severity"
            value={draft.severity}
            options={SEVERITIES.map((s) => ({
              value: s as BugSeverity,
              label: SEVERITY_LABEL[s],
            }))}
            onChange={(v) => set("severity", v)}
          />
        </div>
      )}
    </div>
  );
}
