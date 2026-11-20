import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ScrollText } from "lucide-react";

import { useRunLog } from "@/hooks/useScout";
import type { RunEvent } from "@/lib/scout";
import { Button } from "@/components/ui/button";

const TIME: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * A run's log: every call Claude made to the app, in order, in plain words.
 * Tap one to see exactly what Claude sent and what the app answered.
 */
export function RunLog({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const { data: events, isLoading, isError } = useRunLog(runId, open);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 pointer-coarse:min-h-11"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ScrollText className="h-4 w-4" aria-hidden />
        {open ? "Hide the log" : "Log: what Claude and the app said"}
      </Button>
      {open && isLoading && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
      {open && isError && (
        <p className="text-xs text-destructive">Couldn't load the log.</p>
      )}
      {open && events && events.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing logged for this run. Runs before the log was added have none.
        </p>
      )}
      {open && events && events.length > 0 && (
        <ol className="divide-y rounded-md border" aria-label="Run log">
          {events.map((e) => (
            <Entry key={e.id} event={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Entry({ event: e }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  const hasDetail = !!(e.request || e.response);
  return (
    <li className={e.ok ? "" : "bg-destructive/5"}>
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        className="flex w-full items-start gap-2 p-2 text-left text-xs enabled:hover:bg-muted/50 pointer-coarse:min-h-11"
      >
        {hasDetail ? (
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {new Date(e.created_at).toLocaleTimeString(undefined, TIME)}
        </span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {!e.ok && (
            <AlertTriangle
              className="mr-1 inline h-3.5 w-3.5 text-destructive"
              aria-label="Refused"
            />
          )}
          {e.summary}
        </span>
      </button>
      {open && hasDetail && (
        <div className="space-y-2 px-2 pb-2 pl-8 text-xs">
          <p className="font-mono text-muted-foreground">{e.tool}</p>
          {e.request && <Detail label="Claude sent" value={e.request} />}
          {e.response && <Detail label="The app answered" value={e.response} />}
        </div>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono [overflow-wrap:anywhere]">
        {JSON.stringify(value, null, 1)}
      </pre>
    </div>
  );
}
