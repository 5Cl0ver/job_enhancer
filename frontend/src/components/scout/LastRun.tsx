/**
 * Claude Scout → Start: what the last run did, in one card that stays until
 * the next run, even when it found nothing. And one line for the jobs still
 * waiting on the user, which opens Results.
 */
import { ArrowRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/scout/errorText";
import { RunTip } from "@/components/scout/RunTip";
import { Button } from "@/components/ui/button";
import { useFindings, useTracks, useUpdateTrack } from "@/hooks/useScout";
import { companiesLine, lookingFor, type Run } from "@/lib/scout";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "5 new jobs waiting → Review": Best and Possible jobs not yet saved or
 * passed on, across all runs. Nothing when there are none. */
export function WaitingLine({ onReview }: { onReview: () => void }) {
  const { data } = useFindings(
    { run: null, track: null, status: "new", sort: "fit" },
    1,
  );
  const n = (data?.counts?.best ?? 0) + (data?.counts?.possible ?? 0);
  if (!n) return null;
  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-left font-medium hover:bg-primary/10 pointer-coarse:min-h-11 sm:p-4"
    >
      <span>
        {n} new job{n === 1 ? "" : "s"} waiting for you
      </span>
      <span className="inline-flex items-center gap-1 text-sm text-primary">
        Review <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    </button>
  );
}

export function LastRun({
  run,
  onSeeResults,
}: {
  run: Run;
  onSeeResults: (runId: string) => void;
}) {
  const bands = run.bands ?? { best: 0, possible: 0, long_shot: 0 };
  const found = bands.best + bands.possible + bands.long_shot;
  const looked = run.looked_at?.rows;
  const hidden = run.hidden ?? { repeats: 0, too_far: 0 };
  const companies = companiesLine(run.looked_at);
  const ended = run.status === "stopped" ? "Stopped" : "Finished";

  return (
    <section
      aria-label="Last run"
      className="space-y-2 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-semibold">Last run</h2>
        <p className="text-xs text-muted-foreground">
          {ended} {when(run.finished_at ?? run.created_at)} · {run.name}
        </p>
      </div>
      {run.looking_for && (
        <p className="text-sm text-muted-foreground">
          Looked for: {lookingFor(run.looking_for)}
        </p>
      )}
      <p className="text-sm">
        {looked != null && (
          <>
            Checked {looked} job{looked === 1 ? "" : "s"} ·{" "}
          </>
        )}
        {found === 0 ? (
          "nothing new found"
        ) : (
          <>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {bands.best} best
            </span>
            {" · "}
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {bands.possible} possible
            </span>
            {" · "}
            {bands.long_shot} long shot{bands.long_shot === 1 ? "" : "s"}
          </>
        )}
      </p>
      {companies && (
        <p className="text-sm text-muted-foreground">{companies}</p>
      )}
      {(hidden.repeats > 0 || hidden.too_far > 0) && (
        <p className="text-xs text-muted-foreground">
          Hidden:{" "}
          {[
            hidden.repeats && `${hidden.repeats} you'd already seen`,
            hidden.too_far && `${hidden.too_far} too far away`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {!!run.widened?.length && (
        <p className="text-xs text-muted-foreground">
          Few results, so Scout widened{" "}
          {run.widened.map((w) => `${w.title} to ${w.days} days`).join(", ")}.
        </p>
      )}
      {!!run.not_copied && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Job Catcher didn't copy {run.not_copied} page
          {run.not_copied === 1 ? "" : "s"}: reload it in chrome://extensions
          and refresh your tabs. Those jobs are still in Results; open one and
          press Save.
        </p>
      )}
      {!!run.suggested_titles?.length && <SuggestedTitles run={run} />}
      {run.tip && <RunTip tip={run.tip} />}
      {run.note && (
        <p className="text-sm">
          <span className="font-medium">Claude&apos;s note: </span>
          {run.note}
        </p>
      )}
      <Button
        className="mt-1 w-full gap-1.5 sm:w-auto"
        onClick={() => onSeeResults(run.id)}
      >
        See results <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </section>
  );
}

/** Titles Claude added for this run, each keepable for later runs. */
export function SuggestedTitles({ run }: { run: Run }) {
  const { data: tracks } = useTracks();
  const update = useUpdateTrack();
  const track = tracks?.find((t) => t.name === run.track_name);
  const related = track?.related_titles ?? [];
  const kept = (t: string) =>
    related.some((r) => r.toLowerCase() === t.toLowerCase());
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Claude also searched these titles from your resume:
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {run.suggested_titles!.map((t) => (
          <li key={t}>
            {track && !kept(t) ? (
              <Button
                size="sm"
                variant="outline"
                className="h-auto gap-1 px-2 py-1 text-xs pointer-coarse:min-h-11"
                disabled={update.isPending}
                aria-label={`Keep ${t} for ${track.name}`}
                onClick={() =>
                  update.mutate(
                    { id: track.id, related_titles: [...related, t] },
                    {
                      onSuccess: () =>
                        toast.success(`${track.name} now also searches ${t}.`),
                      onError: (e) =>
                        toast.error(errorText(e, "Couldn't keep that title.")),
                    },
                  )
                }
              >
                <Plus className="h-3 w-3" aria-hidden /> {t}
              </Button>
            ) : (
              <span className="inline-block rounded-md border px-2 py-1 text-xs text-muted-foreground">
                {t}
                {kept(t) ? " · kept" : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
