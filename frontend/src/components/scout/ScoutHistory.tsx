/**
 * Claude Scout → History: past runs, newest first. Open one to see every job it
 * reported and what happened to each.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RunFindings } from "@/components/scout/RunFindings";
import { useRun, useRuns } from "@/hooks/useScout";
import { runSummary, type Run } from "@/lib/scout";
import { Skeleton } from "@/components/ui/skeleton";

export function ScoutHistory() {
  const { data: runs, isLoading, isError } = useRuns();
  // `?run=<id>` opens that run: the link a saved job uses to show its search.
  const [params] = useSearchParams();
  const asked = params.get("run");
  const [openId, setOpenId] = useState<string | null>(asked);
  // The list holds the latest runs only; a linked run older than that is
  // fetched on its own and shown first.
  const older = asked && runs && !runs.some((r) => r.id === asked) ? asked : null;
  const { data: olderRun } = useRun(older);

  if (isLoading) return <Skeleton className="h-28" />;
  if (isError) return <p className="text-sm text-destructive">Couldn't load past searches.</p>;
  if (!runs?.length)
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No searches run yet. Start one from the Start tab.
      </p>
    );

  return (
    <ul className="divide-y rounded-lg border">
      {olderRun && (
        <RunRow
          key={olderRun.id}
          run={olderRun}
          open={openId === olderRun.id}
          onToggle={() => setOpenId(openId === olderRun.id ? null : olderRun.id)}
        />
      )}
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          open={openId === run.id}
          onToggle={() => setOpenId(openId === run.id ? null : run.id)}
        />
      ))}
    </ul>
  );
}

function RunRow({ run, open, onToggle }: { run: Run; open: boolean; onToggle: () => void }) {
  const { data: full, isLoading } = useRun(open ? run.id : null);
  const when = new Date(run.created_at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/50"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{run.name}</span>
          <span className="block text-sm text-muted-foreground">
            {when} · {runSummary(run)}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {run.note && (
            <p className="text-sm">
              <span className="font-medium">Claude's note: </span>
              {run.note}
            </p>
          )}
          {isLoading && <Skeleton className="h-16" />}
          {full && full.findings.length === 0 && (
            <p className="text-sm text-muted-foreground">No jobs reported.</p>
          )}
          {full && full.findings.length > 0 && <RunFindings findings={full.findings} />}
        </div>
      )}
    </li>
  );
}
