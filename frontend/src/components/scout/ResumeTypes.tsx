/**
 * Resume types — one per kind of role the user targets (Business Analyst, IT
 * Admin, …). Each says what Claude Scout should look for and skip, and which
 * resume to apply with. First-time users start from five suggested types.
 */
import { useEffect, useRef, useState } from "react";
import {
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/scout/errorText";
import { FillSkills, PassedTitles } from "@/components/scout/TrackMemory";
import { useResumes } from "@/hooks/useAI";
import { openOwnFile } from "@/lib/openFile";
import {
  resumeSkills,
  useAttachResume,
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
            One for each kind of role you go after. Claude Scout tags every job
            it finds with one, so you always know which resume to apply with.
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
        <p className="text-sm text-destructive">
          Couldn't load your resume types. Try again.
        </p>
      )}

      {tracks && tracks.length === 0 && (
        <StartHere onCustom={() => setEditing("new")} />
      )}

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
        {STARTER_TRACKS.map((t) => t.name).join(" · ")}. You can rename, change
        or delete any of them, and attach a resume to each.
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

/** Open a resume in a new tab, or say why it couldn't be. */
function viewResume(resumeId: string, filename?: string | null) {
  openOwnFile(`/v1/ai/resumes/${resumeId}/file`, filename ?? undefined).catch(
    () => toast.error("Couldn't open that resume. Try uploading it again."),
  );
}

const RESUME_FILES =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function TrackCard({ track: t, onEdit }: { track: Track; onEdit: () => void }) {
  const attach = useAttachResume();
  const fileInput = useRef<HTMLInputElement>(null);
  const onFile = (file: File | undefined) => {
    if (!file) return;
    attach.mutate(
      { track: t, file },
      {
        onSuccess: (filled) =>
          toast.success(
            filled > 0
              ? `Resume attached to ${t.name}. Filled in ${filled} skills from it.`
              : `Resume attached to ${t.name}.`,
          ),
        onError: (e) => toast.error(errorText(e, "Couldn't upload that file.")),
      },
    );
  };
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
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 -mt-1 gap-1"
          onClick={onEdit}
        >
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
        <p className="text-xs text-muted-foreground">
          No job titles yet — add a few.
        </p>
      )}
      {t.key_skills.length === 0 && (
        <>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No skills listed. Add a few, or Claude scores from your uploaded
            resume only.
          </p>
          <FillSkills track={t} />
        </>
      )}
      <PassedTitles track={t} />
      {/* The resume for this type: see it, or put one here without opening Edit. */}
      <input
        ref={fileInput}
        type="file"
        accept={RESUME_FILES}
        className="hidden"
        aria-label={`Resume file for ${t.name}`}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {t.resume_id && t.resume_filename ? (
        <div className="mt-auto flex items-center gap-2 text-xs">
          <FileText
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{t.resume_filename}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={() => viewResume(t.resume_id!, t.resume_filename)}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden /> View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={attach.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {attach.isPending ? "Uploading…" : "Replace"}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="mt-auto w-full gap-2 border-dashed"
          disabled={attach.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {attach.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          {attach.isPending ? "Uploading…" : "Upload the resume for this type"}
        </Button>
      )}
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
        {open && (
          <EditorForm
            key={track?.id ?? "new"}
            track={track}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  track,
  onClose,
}: {
  track: Track | null;
  onClose: () => void;
}) {
  const { data: resumes = [] } = useResumes();
  const create = useCreateTrack();
  const update = useUpdateTrack();
  const remove = useDeleteTrack();
  const upload = useUploadTrackResume();
  const fileInput = useRef<HTMLInputElement>(null);

  const skip = track?.skip_rules ?? DEFAULT_SKIP;
  const [name, setName] = useState(track?.name ?? "");
  const [titles, setTitles] = useState((track?.target_titles ?? []).join("\n"));
  const [related, setRelated] = useState(
    (track?.related_titles ?? []).join("\n"),
  );
  const [exact, setExact] = useState(track?.exact_titles ?? false);
  const [skills, setSkills] = useState((track?.key_skills ?? []).join(", "));
  const [pay, setPay] = useState(
    track?.min_pay != null ? String(track.min_pay) : "",
  );
  const [resumeId, setResumeId] = useState(track?.resume_id ?? NO_RESUME);
  const [degreeOnly, setDegreeOnly] = useState(skip.degree_only);
  const [maxYears, setMaxYears] = useState(
    skip.max_years != null ? String(skip.max_years) : "",
  );
  const [exclude, setExclude] = useState(skip.exclude.join(", "));
  const [notes, setNotes] = useState(track?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending;
  const saveError = create.error ?? update.error ?? remove.error;

  // Which skills the chosen resume names. They fill the skills box when it is
  // empty or still holds exactly what an earlier resume put there, so changing
  // resume changes the skills, but anything the user typed is left alone.
  // "Fill from resume" adds the missing ones to whatever is there.
  const [filling, setFilling] = useState(false);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const autoFilled = useRef<string | null>(null); // what the app last put in the box
  const request = useRef(0); // only the latest choice's answer is used
  const latestSkills = useRef(skills);
  useEffect(() => {
    latestSkills.current = skills;
  }, [skills]);
  const fillSkills = async (id: string, mode: "follow" | "add") => {
    const mine = ++request.current;
    if (id === NO_RESUME) return;
    setFilling(true);
    try {
      const found = await resumeSkills(id);
      if (mine !== request.current || found.length === 0) return;
      // What is in the box now (not when the request began).
      const current = latestSkills.current;
      const untouched = current.trim() === "" || current === autoFilled.current;
      if (mode === "follow" && !untouched) return;
      const have = mode === "follow" ? [] : splitList(current);
      const known = new Set(have.map((s) => s.toLowerCase()));
      const next = [
        ...have,
        ...found.filter((s) => !known.has(s.toLowerCase())),
      ].join(", ");
      autoFilled.current = next;
      setSkills(next);
      setFilledFrom(id);
    } catch {
      // The box just stays as it is; the user can still type.
    } finally {
      if (mine === request.current) setFilling(false);
    }
  };
  const chooseResume = (id: string) => {
    setResumeId(id);
    void fillSkills(id, "follow");
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, { onSuccess: (r) => chooseResume(r.id) });
  };
  // Two files with one name are told apart by the day they were uploaded.
  const nameCount = new Map<string, number>();
  for (const r of resumes)
    nameCount.set(r.filename, (nameCount.get(r.filename) ?? 0) + 1);
  const resumeLabel = (r: (typeof resumes)[number]) =>
    r.filename +
    ((nameCount.get(r.filename) ?? 0) > 1
      ? // Same name, sometimes the same day: the time settles it.
        ` · uploaded ${new Date(r.created_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`
      : "") +
    (r.is_active ? " (main)" : "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const minPay = parsePay(pay);
    const years = maxYears.trim() ? Number(maxYears) : null;
    if (!name.trim()) return setProblem("Give it a name.");
    if (Number.isNaN(minPay))
      return setProblem("Minimum pay should look like 70000 or $70K.");
    if (years != null && (!Number.isInteger(years) || years < 0))
      return setProblem("Max years should be a whole number.");
    setProblem(null);
    const data: TrackInput = {
      name: name.trim(),
      target_titles: splitLines(titles),
      related_titles: splitLines(related),
      exact_titles: exact,
      key_skills: splitList(skills),
      skip_rules: {
        degree_only: degreeOnly,
        max_years: years,
        exclude: splitList(exclude),
      },
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
        <DialogTitle>
          {track ? `Edit ${track.name}` : "New resume type"}
        </DialogTitle>
        <DialogDescription>
          Most of this is filled in for you. Change what you want, then Save.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="track-name">Name</Label>
        <Input
          id="track-name"
          value={name}
          maxLength={60}
          placeholder="e.g. IT Admin"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="track-titles">Job titles to look for</Label>
        <Textarea
          id="track-titles"
          rows={4}
          value={titles}
          placeholder={"e.g. IT Systems Administrator\nJira Administrator"}
          onChange={(e) => setTitles(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One per line, up to 15.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="track-related">Also search for (related titles)</Label>
        <Textarea
          id="track-related"
          rows={3}
          value={related}
          placeholder={"e.g. Systems Administrator\nMicrosoft 365 Admin\nIT Specialist"}
          onChange={(e) => setRelated(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Close variants that cast a wider net. Each title gets its own search.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="track-exact" className="text-sm font-normal">
            Exact titles only
          </Label>
          <p className="text-xs text-muted-foreground">
            {exact
              ? "Titles are searched as exact phrases, together in one search."
              : "Off: titles are searched as plain words, so close variants show up too."}
          </p>
        </div>
        <Switch id="track-exact" checked={exact} onCheckedChange={setExact} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="track-skills">
            Your key skills for this kind of role
          </Label>
          {resumeId !== NO_RESUME && (
            <button
              type="button"
              disabled={filling}
              onClick={() => fillSkills(resumeId, "add")}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              {filling ? "Reading your resume…" : "Fill from resume"}
            </button>
          )}
        </div>
        <Textarea
          id="track-skills"
          rows={3}
          value={skills}
          placeholder="Attach a resume below and these fill in. Or type: Microsoft 365, PowerShell"
          onChange={(e) => setSkills(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {filledFrom === resumeId && resumeId !== NO_RESUME
            ? "Filled in from your resume. Add or remove anything."
            : "Separated by commas. Claude uses these to score how well you fit each job."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="track-pay">Minimum pay (yearly)</Label>
          <Input
            id="track-pay"
            inputMode="numeric"
            value={pay}
            placeholder="e.g. $70K"
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
            <span className="shrink-0 text-sm text-muted-foreground">
              years
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Resume to apply with</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={resumeId} onValueChange={chooseResume}>
            <SelectTrigger
              className="min-w-0 flex-1"
              aria-label="Resume to apply with"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RESUME}>None yet</SelectItem>
              {resumes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {resumeLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {resumeId !== NO_RESUME && (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                viewResume(
                  resumeId,
                  resumes.find((r) => r.id === resumeId)?.filename,
                )
              }
            >
              <Eye className="h-4 w-4" aria-hidden /> View
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={RESUME_FILES}
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
          <div className="min-w-0">
            <Label htmlFor="track-degree" className="text-sm font-normal">
              Needs a degree, with no “or equivalent experience”
            </Label>
            <p className="text-xs text-muted-foreground">
              {degreeOnly
                ? "On: Claude passes these jobs over."
                : "Off: these jobs are scored like any other, the degree listed under gaps."}
            </p>
          </div>
          <Switch
            id="track-degree"
            checked={degreeOnly}
            onCheckedChange={setDegreeOnly}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="track-exclude" className="text-sm font-normal">
            Mentions any of these words
          </Label>
          <Input
            id="track-exclude"
            value={exclude}
            placeholder="e.g. clearance, SAP, Director"
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
          placeholder="e.g. Prefer companies under 500 people."
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
