import { useEffect, useRef, useState } from "react";
import { Check, Copy, EyeOff, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AdminApplyProblem, useApplyProblems, useSetProblemStatus } from "@/hooks/useAdmin";
import { type ApplyProblem, PROBLEM_KIND } from "@/lib/apply";
import { allOpenReport, bugReport, utcTime } from "@/lib/bugReport";
import { cn } from "@/lib/utils";

const KIND_ORDER: ApplyProblem["kind"][] = ["job_catcher", "resume", "tab", "site", "fill", "other"];

const STATUS_TONE: Record<AdminApplyProblem["status"], string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fixed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ignored: "bg-muted text-muted-foreground",
};

/** When the clipboard is blocked: the text, selected, to copy by hand. */
function ManualCopy({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.select(), [text]);
  return (
    <div className="space-y-2 rounded-lg border border-primary/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Couldn't copy. Select it all and copy it by hand.</p>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <textarea
        ref={ref}
        readOnly
        aria-label="Bug report to copy"
        value={text}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
      />
    </div>
  );
}

function Report({
  p,
  onCopy,
}: {
  p: AdminApplyProblem;
  onCopy: (text: string) => void;
}) {
  const set = useSetProblemStatus();
  const mark = (status: AdminApplyProblem["status"]) => set.mutate({ runId: p.run_id, id: p.id, status });
  const open = p.status === "open";
  return (
    <li className="space-y-1.5 py-3">
      <p className="break-words text-sm">{p.what}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {!open && <span className={cn("rounded px-1.5 font-medium", STATUS_TONE[p.status])}>{p.status}</span>}
        {p.site && <span className="truncate">{p.site}</span>}
        <time dateTime={p.at}>{utcTime(p.at)}</time>
        {p.count > 1 && <span>{p.count} times</span>}
      </p>
      <p className="truncate text-xs text-muted-foreground">{[p.job, p.user_email].filter(Boolean).join(" · ")}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onCopy(bugReport(p))}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy for Claude
        </Button>
        {open ? (
          <>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" disabled={set.isPending} onClick={() => mark("fixed")}>
              <Check className="h-3.5 w-3.5" aria-hidden /> Fixed
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" disabled={set.isPending} onClick={() => mark("ignored")}>
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Ignore
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" disabled={set.isPending} onClick={() => mark("open")}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Open again
          </Button>
        )}
      </div>
      {set.isError && <p className="text-xs text-destructive">Couldn't save that. Try again.</p>}
    </li>
  );
}

/**
 * Bug reports (spec 030): what Claude ran into while applying, everyone's,
 * grouped by kind, newest first. Copy one (or every open one) as Markdown
 * for Claude to fix, then mark it Fixed or Ignore. Admin only.
 */
export function BugReportsCard() {
  const { data = [], isLoading, isError, refetch, isFetching } = useApplyProblems();
  const [all, setAll] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const open = data.filter((p) => p.status === "open");
  const shown = all ? data : open;
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: shown.filter((p) => p.kind === kind) })).filter(
    (g) => g.rows.length,
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      toast.success("Copied");
    } catch {
      setManual(text);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Bug reports</CardTitle>
          <CardDescription>What Claude ran into while applying. Copy one for Claude to fix it.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-7 gap-1 text-xs">
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load the bug reports.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Which reports">
                {[
                  { on: false, label: `Open (${open.length})` },
                  { on: true, label: `All (${data.length})` },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={all === o.on}
                    onClick={() => setAll(o.on)}
                    className={cn(
                      "min-h-8 rounded-md px-3 text-sm",
                      all === o.on ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {open.length > 0 && (
                <Button size="sm" className="gap-1.5" onClick={() => copy(allOpenReport(data))}>
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Copy all open
                </Button>
              )}
            </div>
            {manual !== null && <ManualCopy text={manual} onClose={() => setManual(null)} />}
            {!groups.length ? (
              <p className="text-sm text-muted-foreground">{all ? "No bug reports yet." : "Nothing open. All clear."}</p>
            ) : (
              groups.map((g) => (
                <section key={g.kind} aria-label={PROBLEM_KIND[g.kind]} className="rounded-lg border px-3">
                  <h3 className="flex items-center justify-between border-b py-2 text-sm font-semibold">
                    {PROBLEM_KIND[g.kind]}
                    <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                      {g.rows.length}
                    </span>
                  </h3>
                  <ul className="divide-y">
                    {g.rows.map((p) => (
                      <Report key={`${p.run_id}-${p.id}`} p={p} onCopy={copy} />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
