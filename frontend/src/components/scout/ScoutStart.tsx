/**
 * Claude Scout → Start: the user's saved searches, a Start button on each, and
 * the run that's open right now. Start queues a run; the user says one fixed
 * line to Claude in Chrome, which asks the app for everything else, and the
 * jobs it finds appear here live for the user to tick and save.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Copy,
  Loader2,
  Pencil,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { api } from "@/lib/api";
import { errorText } from "@/components/scout/errorText";
import {
  FolderSelect,
  whereReady,
  type Where,
} from "@/components/scout/FolderSelect";
import { RunFindings } from "@/components/scout/RunFindings";
import { RunReview, SavedNote } from "@/components/scout/RunReview";
import { RunTip } from "@/components/scout/RunTip";
import { useCollections, useCreateCollection } from "@/hooks/useSavedJobs";
import {
  type ConfirmResult,
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
  companiesLine,
  formatPay,
  isBoard,
  isOpen,
  lookedAt,
  MAX_JOBS_PER_RUN,
  type Mission,
  type MissionInput,
  needsPlace,
  parsePay,
  POSTED_WITHIN,
  postedLabel,
  RADIUS_MILES,
  type Remote,
  REMOTE_RULES,
  runSummary,
  SCOUT_LINE,
  type Source,
  SOURCE_HINT,
  SOURCES,
  type Track,
  whereLabel,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function ScoutStart({ onSetUpTypes }: { onSetUpTypes: () => void }) {
  const { data: tracks } = useTracks();
  const { data: missions, isLoading, isError } = useMissions();
  const { data: runs } = useRuns();
  const [editing, setEditing] = useState<Mission | "new" | null>(null);
  const openRun = runs?.find(isOpen) ?? null;
  // Finished searches whose good fits are still waiting to be ticked and saved.
  const toReview = runs?.filter((r) => r.needs_review && !isOpen(r)) ?? [];
  // What the last save did; kept here so it outlives the review it came from.
  const [saved, setSaved] = useState<ConfirmResult | null>(null);

  if (tracks && tracks.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-5 text-center sm:p-8">
        <Bot className="mx-auto h-6 w-6 text-primary" aria-hidden />
        <p className="mt-2 font-medium">First, set up your resume types</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Each search looks for one kind of role, so Scout needs to know which
          ones you go after.
        </p>
        <Button className="mt-4" onClick={onSetUpTypes}>
          Set up resume types
        </Button>
      </div>
    );

  return (
    <div className="space-y-6">
      {saved && <SavedNote result={saved} onDismiss={() => setSaved(null)} />}
      {openRun && <LiveRun runId={openRun.id} onSaved={setSaved} />}
      {toReview.map((r) => (
        <FinishedRun key={r.id} runId={r.id} onSaved={setSaved} />
      ))}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Your searches</h2>
            <p className="text-sm text-muted-foreground">
              Press Start, then tell Claude in Chrome one line. It finds the
              jobs; the app remembers every job it has seen, so nothing comes
              back twice.
            </p>
          </div>
          {!!missions?.length && (
            <Button
              onClick={() => setEditing("new")}
              className="shrink-0 gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden /> New search
            </Button>
          )}
        </div>

        {isLoading && <Skeleton className="h-28" />}
        {isError && (
          <p className="text-sm text-destructive">
            Couldn't load your searches. Try again.
          </p>
        )}
        {missions && missions.length === 0 && (
          <div className="rounded-lg border border-dashed p-5 text-center sm:p-8">
            <p className="font-medium">No searches yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              For example: LinkedIn, IT Admin, 5 jobs from the last 7 days, $70K
              or more.
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
    whereLabel(m),
  ].filter(Boolean);
  // Where its jobs go. Older responses don't say; then nothing is shown.
  const into = m.collection_name
    ? `Saves into ${m.collection_name}${m.auto_save ? ", without asking" : ""}`
    : null;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{m.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {details.join(" · ")}
        </p>
        {into && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {into}
          </p>
        )}
      </div>
      {start.isError && (
        <p className="text-xs text-destructive">
          {errorText(start.error, "Couldn't start.")}
        </p>
      )}
      <div className="mt-auto flex gap-2">
        <Button
          className="flex-1 gap-1.5"
          disabled={busy || start.isPending}
          title={
            busy ? "Finish or stop the search that's running first" : undefined
          }
          onClick={() => start.mutate(m.id)}
        >
          {start.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          Start
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onEdit}
          aria-label={`Edit ${m.name}`}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** A finished search with good fits still waiting: the review, on its own. */
function FinishedRun({
  runId,
  onSaved,
}: {
  runId: string;
  onSaved: (result: ConfirmResult) => void;
}) {
  const { data: run } = useRun(runId);
  if (!run) return <Skeleton className="h-40" />;
  if (!run.needs_review) return null;
  const why = lookedAt(run);
  const checked = companiesLine(run.looked_at);
  return (
    <section className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:p-5">
      <div className="min-w-0">
        <p className="font-medium">{run.name}</p>
        <p className="text-sm text-muted-foreground">{runSummary(run)}</p>
        {why && <p className="mt-1 text-sm text-muted-foreground">{why}</p>}
        {why && run.tip && <RunTip tip={run.tip} className="mt-1" />}
        {checked && (
          <p className="mt-1 text-sm text-muted-foreground">{checked}</p>
        )}
        {run.note && (
          <p className="mt-1 text-sm">
            <span className="font-medium">Claude&apos;s note: </span>
            {run.note}
          </p>
        )}
      </div>
      <RunReview run={run} onSaved={onSaved} />
    </section>
  );
}

/** The open run: the line to say, then progress and jobs as they land. */
function LiveRun({
  runId,
  onSaved,
}: {
  runId: string;
  onSaved: (result: ConfirmResult) => void;
}) {
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
          <p
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {isOpen(run) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            {runSummary(run)}
          </p>
          {companiesLine(run.looked_at) && (
            <p className="text-sm text-muted-foreground">
              {companiesLine(run.looked_at)}
            </p>
          )}
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
            Keep Job Catcher on and signed in. It copies each job word for word
            as Claude opens it.
            {run.source === "linkedin" &&
              " Searching LinkedIn this way is against its rules for automated use, so keep searches small."}
            {run.source === "local_companies" &&
              " Claude checks up to 15 companies' own sites, never a job board."}
          </p>
        </div>
      )}

      {/* Good fits can be ticked and saved while the search is still going. */}
      {run.findings.length > 0 &&
        (run.needs_review ? (
          <RunReview run={run} onSaved={onSaved} />
        ) : (
          <RunFindings findings={run.findings} />
        ))}
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

const ANY_DISTANCE = "any";

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
  const [trackId, setTrackId] = useState(
    mission?.track_id ?? tracks[0]?.id ?? "",
  );
  const [count, setCount] = useState(String(mission?.job_count ?? 5));
  const [days, setDays] = useState(String(mission?.posted_within_days ?? 7));
  const [location, setLocation] = useState(mission?.location ?? "");
  const [radius, setRadius] = useState(
    mission?.radius_miles != null ? String(mission.radius_miles) : ANY_DISTANCE,
  );
  const [remote, setRemote] = useState<Remote>(mission?.remote ?? "any");
  const [pay, setPay] = useState(
    mission?.min_pay != null ? String(mission.min_pay) : "",
  );
  const [fit, setFit] = useState(String(mission?.min_fit ?? 6));
  const [extra, setExtra] = useState(mission?.extra_instructions ?? "");
  // Where good fits go: the search's own collection unless one is chosen.
  const [where, setWhere] = useState<Where>({
    collectionId: mission?.collection_id ?? null,
    newName: null,
  });
  const [autoSave, setAutoSave] = useState(mission?.auto_save ?? false);
  const { data: collections = [] } = useCollections();
  const createCollection = useCreateCollection();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const track = tracks.find((t) => t.id === trackId);
  // "Within N miles" only means something around a place, for jobs you'd go to.
  const radiusApplies = location.trim() !== "" && remote !== "remote_only";
  const local = needsPlace(source);
  // Local companies are near you: "remote only" doesn't apply.
  const remoteRules = local
    ? REMOTE_RULES.filter((r) => r.value !== "remote_only")
    : REMOTE_RULES;
  const pickSource = (v: Source) => {
    setSource(v);
    if (needsPlace(v) && remote === "remote_only") setRemote("any");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minPay = parsePay(pay);
    if (Number.isNaN(minPay))
      return setProblem("Minimum pay should look like 70K or 70000.");
    if (!trackId) return setProblem("Pick a resume type.");
    if (local && !location.trim())
      return setProblem(
        "Add a city or area: Scout looks for companies near it.",
      );
    if (!whereReady(where)) return setProblem("Name the new collection.");
    setProblem(null);
    let collectionId = where.collectionId;
    if (where.newName !== null) {
      // A new collection: use the one of that name if there is one, else make it.
      const name = where.newName.trim();
      const byName = (list: { id: string; name: string }[]) =>
        list.find((c) => c.name.toLowerCase() === name.toLowerCase());
      try {
        collectionId =
          byName(collections)?.id ??
          (await createCollection.mutateAsync({ name })).id;
      } catch {
        // Made on an earlier try that then failed to save the search: use it.
        const fresh = await qc
          .fetchQuery({
            queryKey: ["collections"],
            queryFn: () =>
              api.get<{ id: string; name: string }[]>("/v1/collections/"),
            staleTime: 0,
          })
          .catch(() => []);
        collectionId = byName(fresh)?.id ?? null;
        if (!collectionId)
          return setProblem("Couldn't make that collection. Try another name.");
      }
    }
    const data: MissionInput & { id?: string } = {
      id: mission?.id,
      source,
      track_id: trackId,
      job_count: Number(count),
      posted_within_days: Number(days),
      location: location.trim() || null,
      radius_miles:
        radiusApplies && radius !== ANY_DISTANCE ? Number(radius) : null,
      remote,
      min_pay: minPay,
      min_fit: Number(fit),
      extra_instructions: extra.trim() || null,
      collection_id: collectionId,
      auto_save: autoSave,
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
          Where Claude looks, for which kind of role, and what counts as a good
          find.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Where to look">
          <Select value={source} onValueChange={(v) => pickSource(v as Source)}>
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
          {SOURCE_HINT[source] && (
            <p className="text-xs text-muted-foreground">
              {SOURCE_HINT[source]}
            </p>
          )}
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
              {Array.from({ length: MAX_JOBS_PER_RUN }, (_, i) =>
                String(i + 1),
              ).map((n) => (
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
        <Field
          label={local ? "City or area (needed)" : "City or area"}
          htmlFor="scout-location"
        >
          <Input
            id="scout-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Springfield, IL"
            aria-required={local}
          />
        </Field>
        <Field label="How far around it">
          <Select
            value={radiusApplies ? radius : ANY_DISTANCE}
            onValueChange={setRadius}
          >
            <SelectTrigger
              aria-label="How far around it"
              disabled={!radiusApplies}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_DISTANCE}>
                {!radiusApplies
                  ? "Add a city first"
                  : isBoard(source)
                    ? "The job board decides"
                    : "Near the city"}
              </SelectItem>
              {RADIUS_MILES.map((miles) => (
                <SelectItem key={miles} value={String(miles)}>
                  Within {miles} miles
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Remote">
          <Select value={remote} onValueChange={(v) => setRemote(v as Remote)}>
            <SelectTrigger aria-label="Remote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {remoteRules.map((r) => (
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
            placeholder={
              track?.min_pay
                ? `${formatPay(track.min_pay)} (from ${track.name})`
                : "70K"
            }
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
      <Field label="Save into">
        <FolderSelect
          value={where}
          onChange={setWhere}
          ownLabel={
            track
              ? `A collection named “${track.name}”`
              : "A collection for this search"
          }
        />
      </Field>
      <div className="flex items-start gap-3">
        <Switch
          id="scout-auto-save"
          checked={autoSave}
          onCheckedChange={setAutoSave}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor="scout-auto-save">Save good fits without asking</Label>
          <p className="text-xs text-muted-foreground">
            {autoSave
              ? "Good fits go straight into My Jobs. Use this when you won't be around when it finishes."
              : "You pick what to keep when the search finishes."}
          </p>
        </div>
      </div>
      <Field label="Anything else for Claude (optional)" htmlFor="scout-extra">
        <Textarea
          id="scout-extra"
          rows={2}
          maxLength={1000}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="e.g. Skip staffing agencies."
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
              if (
                !window.confirm(
                  `Delete “${mission.name}”? Past results stay in History.`,
                )
              )
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
          {save.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          )}
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
