/**
 * Resume types — one per kind of role the user targets (Business Analyst, IT
 * Admin, …). Each says what Claude Scout should look for and skip, and which
 * resume to apply with. First-time users start from five suggested types.
 */
import { useRef, useState } from "react";
import { FileText, Loader2, Pencil, Plus, Sparkles, Upload } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useResumes } from "@/hooks/useAI";
import {
  useCreateTrack,
  useDeleteTrack,
  useTracks,
  useUpdateTrack,
  useUploadTrackResume,
} from "@/hooks/useScout";
import {
  DEFAULT_SKIP,
  MAX_TRACKS,
  STARTER_TRACKS,
  formatPay,
  parsePay,
  splitLines,
  splitList,
  type Track,
  type TrackInput,
} from "@/lib/scout";
import { Badge } from "@/components/ui/badge";
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

function errorText(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  try {
    const detail = (JSON.parse(e.message) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // not JSON: the message is already readable
  }
  return e.message || fallback;
}

export function ResumeTypes() {
  const { data: tracks, isLoading, isError } = useTracks();
  const [editing, setEditing] = useState<Track | "new" | null>(null);
  const full = (tracks?.length ?? 0) >= MAX_TRACKS;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Resume types</h2>
          <p className="text-sm text-muted-foreground">
            One for each kind of role you go after. Claude Scout tags every job it finds with
            one, so you always know which resume to apply with.
          </p>
        </div>
        {!!tracks?.length && (
          <Button
            onClick={() => setEditing("new")}
            disabled={full}
            className="shrink-0 gap-1.5"
            title={full ? `You can keep up to ${MAX_TRACKS}` : undefined}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add resume type
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Couldn't load your resume types. Try again.</p>
      )}

      {tracks && tracks.length === 0 && <StartHere onCustom={() => setEditing("new")} />}

      {tracks && tracks.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tracks.map((t) => (
            <TrackCard key={t.id} track={t} onEdit={() => setEditing(t)} />
          ))}
        </ul>
      )}

      <TrackEditor
        track={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

/** Empty state: add the five suggested types in one click, or start blank. */
function StartHere({ onCustom }: { onCustom: () => void }) {
  const create = useCreateTrack();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStarters = async () => {
    setAdding(true);
    setError(null);
    try {
      for (const t of STARTER_TRACKS) await create.mutateAsync(t);
    } catch (e) {
      setError(errorText(e, "Couldn't add them all. Try again."));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed p-5 text-center sm:p-8">
      <Sparkles className="mx-auto h-6 w-6 text-primary" aria-hidden />
      <p className="mt-2 font-medium">Start with five suggested resume types</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {STARTER_TRACKS.map((t) => t.name).join(" · ")}. You can rename, change or delete any
        of them, and attach a resume to each.
      </p>
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <Button onClick={addStarters} disabled={adding} className="gap-1.5">
          {adding && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Add the five suggested types
        </Button>
        <Button variant="outline" onClick={onCustom} disabled={adding}>
          Make my own
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function TrackCard({ track: t, onEdit }: { track: Track; onEdit: () => void }) {
  const shown = t.target_titles.slice(0, 4);
  const more = t.target_titles.length - shown.length;
  const pay = formatPay(t.min_pay);
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium [overflow-wrap:anywhere]">{t.name}</p>
          <p className="text-xs text-muted-foreground">
            {t.job_count} saved job{t.job_count === 1 ? "" : "s"}
            {pay && ` · ${pay}+`}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="-mr-2 -mt-1 gap-1" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
        </Button>
      </div>
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((title) => (
            <Badge key={title} variant="secondary" className="font-normal">
              {title}
            </Badge>
          ))}
          {more > 0 && (
            <Badge variant="outline" className="font-normal">
              +{more} more
            </Badge>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No job titles yet — add a few.</p>
      )}
      <p className="mt-auto flex items-center gap-1.5 text-xs">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {t.resume_filename ? (
          <span className="truncate">{t.resume_filename}</span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">No resume attached yet</span>
        )}
      </p>
    </li>
  );
}

const NO_RESUME = "none";

/** Add or edit one resume type. Delete lives here too, behind a confirm. */
function TrackEditor({
  track,
  open,
  onClose,
}: {
  track: Track | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        {/* Keyed so each open starts from the track's current values. */}
        {open && <EditorForm key={track?.id ?? "new"} track={track} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const { data: resumes = [] } = useResumes();
  const create = useCreateTrack();
  const update = useUpdateTrack();
  const remove = useDeleteTrack();
  const upload = useUploadTrackResume();
  const fileInput = useRef<HTMLInputElement>(null);

  const skip = track?.skip_rules ?? DEFAULT_SKIP;
  const [name, setName] = useState(track?.name ?? "");
  const [titles, setTitles] = useState((track?.target_titles ?? []).join("\n"));
  const [skills, setSkills] = useState((track?.key_skills ?? []).join(", "));
  const [pay, setPay] = useState(track?.min_pay != null ? String(track.min_pay) : "");
  const [resumeId, setResumeId] = useState(track?.resume_id ?? NO_RESUME);
  const [degreeOnly, setDegreeOnly] = useState(skip.degree_only);
  const [maxYears, setMaxYears] = useState(skip.max_years != null ? String(skip.max_years) : "");
  const [exclude, setExclude] = useState(skip.exclude.join(", "));
  const [notes, setNotes] = useState(track?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending;
  const saveError = create.error ?? update.error ?? remove.error;

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, { onSuccess: (r) => setResumeId(r.id) });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const minPay = parsePay(pay);
    const years = maxYears.trim() ? Number(maxYears) : null;
    if (!name.trim()) return setProblem("Give it a name.");
    if (Number.isNaN(minPay)) return setProblem("Minimum pay should look like 70000 or $70K.");
    if (years != null && (!Number.isInteger(years) || years < 0))
      return setProblem("Max years should be a whole number.");
    setProblem(null);
    const data: TrackInput = {
      name: name.trim(),
      target_titles: splitLines(titles),
      key_skills: splitList(skills),
      skip_rules: { degree_only: degreeOnly, max_years: years, exclude: splitList(exclude) },
      min_pay: minPay,
      resume_id: resumeId === NO_RESUME ? null : resumeId,
      notes: notes.trim() || null,
    };
    if (track) update.mutate({ id: track.id, ...data }, { onSuccess: onClose });
    else create.mutate(data, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{track ? `Edit ${track.name}` : "New resume type"}</DialogTitle>
        <DialogDescription>
          What Claude Scout should look for, what to skip, and the resume to apply with.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="track-name">Name</Label>
        <Input
          id="track-name"
          value={name}
          maxLength={60}
          placeholder="IT Admin"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="track-titles">Job titles to look for</Label>
        <Textarea
          id="track-titles"
          rows={4}
          value={titles}
          placeholder={"IT Systems Administrator\nJira Administrator"}
          onChange={(e) => setTitles(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One per line, up to 15.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="track-skills">Your key skills for this kind of role</Label>
        <Textarea
          id="track-skills"
          rows={2}
          value={skills}
          placeholder="Microsoft 365, Entra ID, PowerShell"
          onChange={(e) => setSkills(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Separated by commas. Claude uses these to score how well you fit each job.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="track-pay">Minimum pay (yearly)</Label>
          <Input
            id="track-pay"
            inputMode="numeric"
            value={pay}
            placeholder="$70K"
            onChange={(e) => setPay(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="track-years">Skip jobs asking for more than</Label>
          <div className="flex items-center gap-2">
            <Input
              id="track-years"
              inputMode="numeric"
              value={maxYears}
              placeholder="No limit"
              onChange={(e) => setMaxYears(e.target.value)}
            />
            <span className="shrink-0 text-sm text-muted-foreground">years</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Resume to apply with</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={resumeId} onValueChange={setResumeId}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Resume to apply with">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RESUME}>None yet</SelectItem>
              {resumes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.filename}
                  {r.is_active ? " (main)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Upload new
          </Button>
        </div>
        {upload.isError && (
          <p className="text-xs text-destructive">
            {errorText(upload.error, "Couldn't upload that file.")}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Skip these jobs</p>
        <div className="flex items-start justify-between gap-3">
          <Label htmlFor="track-degree" className="text-sm font-normal">
            Needs a degree, with no “or equivalent experience”
          </Label>
          <Switch id="track-degree" checked={degreeOnly} onCheckedChange={setDegreeOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="track-exclude" className="text-sm font-normal">
            Mentions any of these words
          </Label>
          <Input
            id="track-exclude"
            value={exclude}
            placeholder="clearance, SAP, Director"
            onChange={(e) => setExclude(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="track-notes">Notes for Claude (optional)</Label>
        <Textarea
          id="track-notes"
          rows={2}
          maxLength={2000}
          value={notes}
          placeholder="Prefer companies under 500 people."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {(problem || saveError) && (
        <p className="text-sm text-destructive">
          {problem ?? errorText(saveError, "Couldn't save. Try again.")}
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {track ? (
          confirmDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => remove.mutate(track.id, { onSuccess: onClose })}
            >
              Yes, delete {track.name}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
