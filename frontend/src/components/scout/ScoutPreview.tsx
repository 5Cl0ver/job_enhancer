import { useState } from "react";

import { useMissions, usePreview } from "@/hooks/useScout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Brief fields shown as their own blocks, in this order, with plain names. */
const TEXTS: [string, string][] = [
  ["playbook", "Main steps, scoring and the rules that always apply"],
  ["source_steps", "Extra steps for this kind of search"],
  ["broad_steps", "Extra steps: Anything I'd be good at"],
];
const SKIP = new Set([...TEXTS.map(([k]) => k), "preview", "run_id"]);

/**
 * What Claude would be given if a saved search started now. Nothing starts:
 * the app builds the brief and shows it.
 */
export function ScoutPreview() {
  const { data: missions = [] } = useMissions();
  const [missionId, setMissionId] = useState<string | null>(null);
  const { data: brief, isLoading, isError } = usePreview(missionId);

  if (missions.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Make a search first, then preview what Claude would get for it.
      </p>
    );

  return (
    <div className="space-y-3">
      <Select value={missionId ?? ""} onValueChange={setMissionId}>
        <SelectTrigger aria-label="Search to preview">
          <SelectValue placeholder="Pick a search to preview" />
        </SelectTrigger>
        <SelectContent>
          {missions.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLoading && missionId && (
        <p className="text-sm text-muted-foreground">Building the brief…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">Couldn't build the preview.</p>
      )}
      {brief && (
        <div className="space-y-3" aria-label="What Claude would get">
          <p className="text-xs text-muted-foreground">
            Exactly what Claude gets when this search starts. Nothing was started.
          </p>
          {TEXTS.map(([key, label]) =>
            typeof brief[key] === "string" ? (
              <Block key={key} label={label}>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
                  {brief[key] as string}
                </pre>
              </Block>
            ) : null,
          )}
          <Block label="Everything else in the brief">
            <dl className="space-y-1.5 text-xs">
              {Object.entries(brief)
                .filter(([k]) => !SKIP.has(k))
                .map(([k, v]) => (
                  <div key={k} className="grid gap-0.5 sm:grid-cols-[10rem_1fr]">
                    <dt className="font-medium">{k.replace(/_/g, " ")}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap font-mono text-muted-foreground [overflow-wrap:anywhere]">
                      {typeof v === "string" ? v : JSON.stringify(v, null, 1)}
                    </dd>
                  </div>
                ))}
            </dl>
          </Block>
        </div>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 rounded-md border bg-muted/30 p-3">
      <h4 className="text-sm font-medium">{label}</h4>
      {children}
    </section>
  );
}
