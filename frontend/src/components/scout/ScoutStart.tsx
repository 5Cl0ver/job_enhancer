/**
 * Claude Scout → Start: the user's saved searches, a Start button on each, and
 * the run that's open right now. Start queues a run; the user says one fixed
 * line to Claude in Chrome, which asks the app for everything else, and the
 * jobs it saves appear here live.
 */
import { useState } from "react";
import { Bot, Check, Copy, Loader2, Pencil, Play, Plus, Square } from "lucide-react";
import { errorText } from "@/components/scout/errorText";
import { RunFindings } from "@/components/scout/RunFindings";
import {
  useDeleteMission,
  useMissions,
  useRun,
  useRuns,
  useSaveMission,
  useStartRun,
  useStopRun,
  useTracks,
} from "@/hooks/useScout";
import {
  MAX_JOBS_PER_RUN,
  POSTED_WITHIN,
  REMOTE_RULES,
  SCOUT_LINE,
  SOURCES,
  formatPay,
  isOpen,
  parsePay,
  postedLabel,
  runSummary,
  type Mission,
  type MissionInput,
  type Remote,
  type Source,
  type Track,
} from "@/lib/scout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export function ScoutStart({ onSetUpTypes }: { onSetUpTypes: () => void }) {
  const { data: tracks } = useTracks();
  const { data: missions, isLoading, isError } = useMissions();
  const { data: runs } = useRuns();
  const [editing, setEditing] = useState<Mission | "new" | null>(null);
  const openRun = runs?.find(isOpen) ?? null;

  if (tracks && tracks.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-5 text-center sm:p-8">
        <Bot className="mx-auto h-6 w-6 text-primary" aria-hidden />
        <p className="mt-2 font-medium">First, set up your resume types</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Each search looks for one kind of role, so Scout needs to know which ones you go after.
        </p>
        <Button className="mt-4" onClick={onSetUpTypes}>
          Set up resume types
        </Button>
      </div>
    );

  return (
    <div className="space-y-6">
      {openRun && <LiveRun runId={openRun.id} />}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Your searches</h2>
            <p className="text-sm text-muted-foreground">
              Press Start, then tell Claude in Chrome one line. It finds the jobs; the app
              remembers every job it has seen, so nothing comes back twice.
            </p>
          </div>
          {!!missions?.length && (
            <Button onClick={() => setEditing("new")} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" aria-hidden /> New search
            </Button>
          )}
        </div>

        {isLoading && <Skeleton className="h-28" />}
        {isError && (
          <p className="text-sm text-destructive">Couldn't load your searches. Try again.</p>
        )}
        {missions && missions.length === 0 && (
          <div className="rounded-lg border border-dashed p-5 text-center sm:p-8">
            <p className="font-medium">No searches yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              For example: LinkedIn, IT Admin, 5 jobs from the last 7 days, $70K or more.
            </p>
            <Button className="mt-4 gap-1.5" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" aria-hidden /> Make your first search
            </Button>
          </div>
        )}
        {missions && missions.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {missions.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                track={tracks?.find((t) => t.id === m.track_id)}
                busy={!!openRun}
                onEdit={() => setEditing(m)}
              />
            ))}
          </ul>
        )}
      </section>

      <MissionEditor
        mission={editing === "new" ? null : editing}
        tracks={tracks ?? []}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function MissionCard({
  mission: m,
  track,
  busy,
  onEdit,
}: {
  mission: Mission;
  track: Track | undefined;
  busy: boolean;
  onEdit: () => void;
}) {
  const start = useStartRun();
  const pay = formatPay(m.min_pay ?? track?.min_pay ?? null);
  const details = [
    `${m.job_count} jobs`,
    postedLabel(m.posted_within_days).toLowerCase(),
    pay && `${pay}+`,
    `fit ${m.min_fit}+`,
    m.location,
  ].filter(Boolean);

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{m.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{details.join(" · ")}</p>
      </div>
      {start.isError && (
        <p className="text-xs text-destructive">{errorText(start.error, "Couldn't start.")}</p>
      )}
      <div className="mt-auto flex gap-2">
        <Button
          className="flex-1 gap-1.5"
          disabled={busy || start.isPending}
          title={busy ? "Finish or stop the search that's running first" : undefined}
          onClick={() => start.mutate(m.id)}
        >
          {start.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          Start
        </Button>
        <Button variant="outline" size="icon" onClick={onEdit} aria-label={`Edit ${m.name}`}>
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** The open run: the line to say, then progress and jobs as they land. */
function LiveRun({ runId }: { runId: string }) {
  const { data: run } = useRun(runId);
  const stop = useStopRun();
  const [copied, setCopied] = useState(false);
  if (!run) return <Skeleton className="h-40" />;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SCOUT_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the line is on screen to copy by hand.
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{run.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
            {isOpen(run) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {runSummary(run)}
          </p>
        </div>
        {isOpen(run) && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 self-start"
            disabled={stop.isPending}
            onClick={() => stop.mutate(run.id)}
          >
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop
          </Button>
        )}
      </div>

      {run.status === "queued" && (
        <div className="space-y-2">
          <p className="text-sm">
            Open the Claude side panel in Chrome and say:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm">
              {SCOUT_LINE}
            </code>
            <Button variant="secondary" className="gap-1.5" onClick={copy}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep Job Catcher on and signed in. It copies each job word for word as Claude
            opens it. Searching LinkedIn this way is against its rules for automated use, so
            keep searches small.
          </p>
        </div>
      )}

      {run.findings.length > 0 && <RunFindings findings={run.findings} />}
    </section>
  );
}

function MissionEditor({
  mission,
  tracks,
  open,
  onClose,
}: {
  mission: Mission | null;
  tracks: Track[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <MissionForm
            key={mission?.id ?? "new"}
            mission={mission}
            tracks={tracks}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MissionForm({
  mission,
  tracks,
  onDone,
}: {
  mission: Mission | null;
  tracks: Track[];
  onDone: () => void;
}) {
  const save = useSaveMission();
  const del = useDeleteMission();
  const [source, setSource] = useState<Source>(mission?.source ?? "linkedin");
  const [trackId, setTrackId] = useState(mission?.track_id ?? tracks[0]?.id ?? "");
  const [count, setCount] = useState(String(mission?.job_count ?? 5));
  const [days, setDays] = useState(String(mission?.posted_within_days ?? 7));
  const [location, setLocation] = useState(mission?.location ?? "");
  const [remote, setRemote] = useState<Remote>(mission?.remote ?? "any");
  const [pay, setPay] = useState(mission?.min_pay != null ? String(mission.min_pay) : "");
  const [fit, setFit] = useState(String(mission?.min_fit ?? 6));
  const [extra, setExtra] = useState(mission?.extra_instructions ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const track = tracks.find((t) => t.id === trackId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minPay = parsePay(pay);
    if (Number.isNaN(minPay)) return setProblem("Minimum pay should look like 70K or 70000.");
    if (!trackId) return setProblem("Pick a resume type.");
    setProblem(null);
    const data: MissionInput & { id?: string } = {
      id: mission?.id,
      source,
      track_id: trackId,
      job_count: Number(count),
      posted_within_days: Number(days),
      location: location.trim() || null,
      remote,
      min_pay: minPay,
      min_fit: Number(fit),
      extra_instructions: extra.trim() || null,
    };
    // A saved name follows the settings unless the user renamed it.
    if (mission) data.name = null;
    try {
      await save.mutateAsync(data);
      onDone();
    } catch {
      // shown below
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{mission ? "Edit search" : "New search"}</DialogTitle>
        <DialogDescription>
          Where Claude looks, for which kind of role, and what counts as a good find.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Where to look">
          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger aria-label="Where to look">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Resume type">
          <Select value={trackId} onValueChange={setTrackId}>
            <SelectTrigger aria-label="Resume type">
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {tracks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="How many jobs">
          <Select value={count} onValueChange={setCount}>
            <SelectTrigger aria-label="How many jobs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: MAX_JOBS_PER_RUN }, (_, i) => String(i + 1)).map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Posted">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger aria-label="Posted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSTED_WITHIN.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="City or area" htmlFor="scout-location">
          <Input
            id="scout-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Springfield, IL"
          />
        </Field>
        <Field label="Remote">
          <Select value={remote} onValueChange={(v) => setRemote(v as Remote)}>
            <SelectTrigger aria-label="Remote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMOTE_RULES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Minimum pay (yearly)" htmlFor="scout-pay">
          <Input
            id="scout-pay"
            inputMode="numeric"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            placeholder={track?.min_pay ? `${formatPay(track.min_pay)} (from ${track.name})` : "70K"}
          />
        </Field>
        <Field label="Minimum fit (0–10)">
          <Select value={fit} onValueChange={setFit}>
            <SelectTrigger aria-label="Minimum fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 11 }, (_, i) => String(i)).map((n) => (
                <SelectItem key={n} value={n}>
                  {n === "0" ? "Any" : `${n}+`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Anything else for Claude (optional)" htmlFor="scout-extra">
        <Textarea
          id="scout-extra"
          rows={2}
          maxLength={1000}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Skip staffing agencies."
        />
      </Field>

      {(problem || save.isError || del.isError) && (
        <p className="text-sm text-destructive">
          {problem ??
            errorText(save.error ?? del.error, "Couldn't save. Try again.")}
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {mission ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            disabled={del.isPending}
            onClick={async () => {
              if (!window.confirm(`Delete “${mission.name}”? Past results stay in History.`))
                return;
              try {
                await del.mutateAsync(mission.id);
                onDone();
              } catch {
                // shown above
              }
            }}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Save search
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
