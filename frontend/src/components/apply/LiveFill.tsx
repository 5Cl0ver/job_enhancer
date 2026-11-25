import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApplyRun } from "@/lib/apply";

const FRESH_MS = 4000;

/**
 * "Filling now" (spec 026): every box on the page Claude is filling and
 * what's in it, as Job Catcher reads it every few seconds. No Claude tokens:
 * Job Catcher reads the page. A box that just changed lights up for a moment.
 */
export function LiveFill({ run }: { run: ApplyRun }) {
  const filling = run.status === "filling" || run.status === "needs_you";
  const live = filling ? run.live : null;
  const seen = useRef(new Map<string, string>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!live) return;
    const changed = new Set<string>();
    for (const b of live.boxes) {
      const before = seen.current.get(b.q);
      if (before !== undefined && before !== b.a) changed.add(b.q);
      seen.current.set(b.q, b.a);
    }
    if (changed.size) setFresh(changed);
  }, [live]);

  // Its own timer, so an update with nothing new never leaves a box lit.
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  if (!filling) return null;
  if (!live) {
    // An older Job Catcher can't read the page for this.
    return run.job_catcher?.new_enough && run.job_catcher.live === false ? (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        Update Job Catcher to watch the boxes fill here.
      </p>
    ) : null;
  }
  const done = live.boxes.filter((b) => b.a.trim()).length;
  return (
    <section className="space-y-2 rounded-lg border p-4" aria-label="Filling now">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
          <Radio className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden />
          <span className="truncate">Filling now{live.title ? `: ${live.title}` : ""}</span>
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {done} of {live.boxes.length} filled
        </span>
      </div>
      {live.boxes.length ? (
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {live.boxes.map((b, i) => (
            <li
              key={`${i}-${b.q}`}
              className={cn(
                "grid gap-0.5 rounded px-2 py-1 transition-colors duration-700 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3",
                fresh.has(b.q) && "bg-primary/10",
              )}
            >
              <span className="truncate text-muted-foreground">{b.q}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("truncate", !b.a.trim() && "text-muted-foreground")}>{b.a.trim() || "…"}</span>
                {b.by === "job_catcher" && (
                  <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">Job Catcher</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Looking for boxes on this page…</p>
      )}
    </section>
  );
}
