import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";

import { useMissionTitles } from "@/hooks/useScout";
import type { Overrides } from "@/lib/scout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LISTS: {
  key: keyof Overrides;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: "always",
    label: "Always search",
    hint: "Searched on every run, first.",
    placeholder: "e.g. Jira Administrator",
  },
  {
    key: "never",
    label: "Never search",
    hint: "Claude never searches these titles.",
    placeholder: "e.g. Help Desk Technician",
  },
  {
    key: "avoid",
    label: "Skip jobs with these words",
    hint: "A job whose title has one isn't opened.",
    placeholder: "e.g. sales, call center",
  },
];

const MAX = 20;

/**
 * An "Anything I'd be good at" search's overrides. Claude decides on its own;
 * these lists are only for stepping in. With a saved search, the titles it has
 * tried so far are listed too.
 */
export function BroadOverrides({
  value,
  onChange,
  missionId,
}: {
  value: Overrides;
  onChange: (next: Overrides) => void;
  missionId: string | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        Claude decides on its own. Step in here only if you want to.
      </p>
      {LISTS.map((l) => (
        <ListEditor
          key={l.key}
          id={`scout-${l.key}`}
          label={l.label}
          hint={l.hint}
          placeholder={l.placeholder}
          items={value[l.key]}
          onChange={(items) => onChange({ ...value, [l.key]: items })}
        />
      ))}
      {missionId && <TitlesTried missionId={missionId} />}
    </div>
  );
}

function ListEditor({
  id,
  label,
  hint,
  placeholder,
  items,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    // Commas add several at once.
    const fresh = draft
      .split(",")
      .map((t) => t.split(/\s+/).join(" ").trim())
      .filter(Boolean)
      .filter(
        (t) => !items.some((i) => i.toLowerCase() === t.toLowerCase()),
      );
    if (fresh.length) onChange([...items, ...fresh].slice(0, MAX));
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {items.map((item) => (
            <li key={item}>
              <Badge variant="secondary" className="gap-1 py-0.5 pr-1 font-normal">
                {item}
                <button
                  type="button"
                  onClick={() => onChange(items.filter((i) => i !== item))}
                  aria-label={`Remove ${item}`}
                  className="rounded p-0.5 hover:bg-muted pointer-coarse:p-1.5"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={160}
          placeholder={placeholder}
          disabled={items.length >= MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-1 pointer-coarse:min-h-11"
          disabled={!draft.trim() || items.length >= MAX}
          onClick={add}
          aria-label={`Add to ${label}`}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

/** Every title the search has tried, folded away. */
function TitlesTried({ missionId }: { missionId: string }) {
  const [open, setOpen] = useState(false);
  const { data: titles, isLoading } = useMissionTitles(open ? missionId : null);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium pointer-coarse:min-h-11"
      >
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        Titles tried
      </button>
      {open && (
        <div className="mt-2">
          {isLoading && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {titles && titles.length === 0 && (
            <p className="text-xs text-muted-foreground">
              None yet: they show here after the first run.
            </p>
          )}
          {titles && titles.length > 0 && (
            <ul className="divide-y text-sm">
              {titles.map((t) => (
                <li
                  key={t.title}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {t.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.good_fits} good fit{t.good_fits === 1 ? "" : "s"} ·{" "}
                    {t.runs} run{t.runs === 1 ? "" : "s"}
                    {t.resting && " · resting 2 weeks"}
                    {t.always && " · always"}
                    {t.never && " · never"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
