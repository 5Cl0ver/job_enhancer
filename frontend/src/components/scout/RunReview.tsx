/**
 * The review after (or during) a Scout search: Claude proposes, the user
 * decides. Good fits arrive ticked, weaker ones unticked, the collection is
 * already filled in, and one button saves what's ticked. Nothing reaches My
 * Jobs before that press.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { errorText } from "@/components/scout/errorText";
import {
  FolderSelect,
  OWN,
  whereBody,
  whereReady,
  type Where,
} from "@/components/scout/FolderSelect";
import { Button } from "@/components/ui/button";
import { useConfirmRun, type ConfirmResult } from "@/hooks/useScout";
import { folderLink } from "@/lib/origin";
import { reviewTicks, type Finding, type Run } from "@/lib/scout";
import { cn } from "@/lib/utils";

/** What a save did, for the line shown afterwards. */
export function SavedNote({
  result,
  onDismiss,
}: {
  result: ConfirmResult;
  onDismiss?: () => void;
}) {
  const saved = result.saved.length;
  const already = result.already.length;
  const failed = result.failed.length;
  const where = result.folder.id ? (
    <Link to={folderLink(result.folder.id)} className="font-medium underline underline-offset-2">
      View
    </Link>
  ) : null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm"
    >
      <p className="min-w-0 flex-1">
        {saved > 0 ? (
          <>
            <span className="font-medium">
              {saved} saved to My Jobs › {result.folder.name}
            </span>
            {where && <> · {where}</>}
          </>
        ) : (
          <span className="font-medium">Nothing new was saved.</span>
        )}
        {already > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {already} {already === 1 ? "was" : "were"} already in My Jobs
          </span>
        )}
        {failed > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {failed} couldn&apos;t be saved (no copy of the page; open the posting and save it)
          </span>
        )}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted-foreground underline underline-offset-2 pointer-coarse:min-h-11"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

function Row({
  finding: f,
  ticked,
  onToggle,
}: {
  finding: Finding;
  ticked: boolean;
  onToggle: () => void;
}) {
  const name = f.title || "A job whose page wasn't copied";
  const status =
    f.outcome === "saved"
      ? "Saved"
      : f.outcome === "duplicate"
        ? "Already in My Jobs"
        : f.outcome === "waiting_for_copy"
          ? "Copying the page…"
          : !f.can_save
            ? "Couldn't copy the page"
            : null;
  return (
    <li className="flex gap-3 px-3 py-2.5">
      {f.can_save ? (
        <label className="flex h-6 shrink-0 cursor-pointer items-center pointer-coarse:-m-2.5 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:justify-center">
          <input
            type="checkbox"
            checked={ticked}
            onChange={onToggle}
            aria-label={`Keep ${name}${f.company ? ` at ${f.company}` : ""}`}
            className="h-4.5 w-4.5 accent-primary"
          />
        </label>
      ) : (
        <span className="flex h-6 w-4.5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          –
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className={cn("min-w-0 font-medium leading-snug", !f.can_save && "text-muted-foreground")}>
            {name}
            {f.company && <span className="font-normal text-muted-foreground"> · {f.company}</span>}
          </p>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
            fit {f.fit_score}/10
          </span>
        </div>
        {status && (
          <p className="text-xs text-muted-foreground">
            {status}
            {(f.outcome === "saved" || f.outcome === "duplicate") && f.job_listing_id && (
              <>
                {" · "}
                <Link
                  to={`/jobs/${f.job_listing_id}`}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </>
            )}
          </p>
        )}
        {f.can_save && f.app_note && <p className="text-xs text-amber-600 dark:text-amber-400">{f.app_note}</p>}
        {f.closest_track_name && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Closest · </span>
            {f.closest_track_name}
          </p>
        )}
        {f.why_fit && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Why · </span>
            {f.why_fit}
          </p>
        )}
        {f.gaps && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Gaps · </span>
            {f.gaps}
          </p>
        )}
      </div>
      <a
        href={f.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open the posting for ${name}`}
        className="flex h-6 shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline pointer-coarse:h-11"
      >
        View <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </li>
  );
}

export function RunReview({
  run,
  onSaved,
}: {
  run: Run;
  onSaved: (result: ConfirmResult) => void;
}) {
  const confirm = useConfirmRun();
  // Only the user's changes are kept; everything else follows Claude's picks,
  // so jobs that arrive while the search is still running come in ticked.
  const [changed, setChanged] = useState<Map<string, boolean>>(new Map());
  const [where, setWhere] = useState<Where>(OWN);
  const ticks = useMemo(() => reviewTicks(run.findings, changed), [run.findings, changed]);
  const good = run.findings.filter((f) => f.outcome === "picked").length;
  const n = ticks.size;

  const save = () =>
    confirm.mutate(
      {
        runId: run.id,
        finding_ids: [...ticks],
        // Only what's on screen: a job Claude found a moment ago stays waiting.
        shown_ids: run.findings.map((f) => f.id),
        ...whereBody(where),
      },
      {
        onSuccess: (result) => {
          setChanged(new Map());
          setWhere(OWN);
          onSaved(result);
        },
      },
    );

  return (
    <section aria-label="Pick what to keep" className="rounded-lg border bg-background">
      <div className="px-3 pb-1 pt-3">
        <h3 className="font-semibold">
          Claude found {good} good {good === 1 ? "fit" : "fits"}. Pick what to keep.
        </h3>
        <p className="text-sm text-muted-foreground">
          Nothing is in My Jobs until you press the button.
        </p>
      </div>
      <ul className="divide-y">
        {run.findings.map((f) => (
          <Row
            key={f.id}
            finding={f}
            ticked={ticks.has(f.id)}
            onToggle={() =>
              setChanged((m) => new Map(m).set(f.id, !ticks.has(f.id)))
            }
          />
        ))}
      </ul>
      {confirm.isError && (
        <p className="px-3 pb-2 text-sm text-destructive">
          {errorText(confirm.error, "Couldn't save. Try again.")}
        </p>
      )}
      {/* On a phone this bar stays in reach, just above the tab bar. */}
      <div className="flex flex-col gap-2 rounded-b-lg border-t bg-card px-3 py-2.5 max-md:sticky max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between">
        {/* One line even on a phone, so the bar stays short over the list. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">Save into</span>
          <FolderSelect
            value={where}
            onChange={setWhere}
            ownLabel={run.folder?.name ?? "Scout"}
            ownId={run.folder?.id}
          />
        </div>
        <Button
          onClick={save}
          variant={n > 0 ? "default" : "outline"}
          disabled={confirm.isPending || (n > 0 && !whereReady(where))}
          className="shrink-0 gap-1.5"
        >
          {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {n > 0 ? `Save ${n} to My Jobs` : "Keep none"}
        </Button>
      </div>
    </section>
  );
}
