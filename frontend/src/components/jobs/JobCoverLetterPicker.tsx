import { useState } from "react";
import { Download, Eye, Loader2, Mail, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { documentFile, pdfName, useFileViewer } from "@/components/common/FileViewer";
import { saveBlob } from "@/components/common/PdfViewer";
import { useUpdateDocument } from "@/hooks/useAI";
import {
  useCoverLetters,
  useSetJobCoverLetter,
  useWriteJobCoverLetter,
  type CoverLetterItem,
} from "@/hooks/useCoverLetters";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GeneratedDocument } from "@/types/api";

const MAX_CHARS = 10_000;

/** What the job page and Settings say when there's no letter at all. */
export const NO_LETTER_YET = "None yet. Claude writes one when an application asks for it.";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "Cover letter - Northwind Labs.pdf": the name it's shown and downloaded under. */
export const letterFileName = (company?: string | null) => pdfName("Cover letter", company);

/** "For this job · Nov 25", or the job it was written for. */
function labelOf(letter: CoverLetterItem, jobListingId: string) {
  if (letter.job_listing_id === jobListingId) return `For this job · ${day(letter.created_at)}`;
  return `${letter.company || letter.job_title || "Another job"} · ${day(letter.created_at)}`;
}

/**
 * View a cover letter in the app, download it, and change its text (the PDF
 * is drawn from the text, so it's remade). Returns the buttons and the editor
 * separately, so the editor can take the row's full width.
 */
function useLetterActions(id: string, filename: string) {
  const [text, setText] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const update = useUpdateDocument();
  const { view, viewer } = useFileViewer();
  const editing = text !== null;

  // The letter as it is now (with the user's last edit), fetched on Edit.
  const edit = async () => {
    setOpening(true);
    setOpenFailed(false);
    try {
      const doc = await api.get<GeneratedDocument>(`/v1/ai/documents/${id}`);
      setText(doc.edited_content ?? doc.content);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };
  // Straight to the phone or computer's downloads, under its readable name.
  const download = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      saveBlob(await api.getBlob(documentFile(id, filename).path), filename);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const tooLong = (text ?? "").length > MAX_CHARS;
  const words = (text ?? "").trim() ? (text ?? "").trim().split(/\s+/).length : 0;
  const button = "h-9 gap-1.5 pointer-coarse:h-11";

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        className={button}
        aria-label={`View ${filename}`}
        onClick={() => view(documentFile(id, filename))}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden /> View
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={button}
        aria-label={`Download ${filename}`}
        disabled={saving}
        onClick={download}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
        Download
      </Button>
      {!editing && (
        <Button variant="outline" size="sm" className={button} disabled={opening} onClick={edit}>
          {opening ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          )}
          Edit text
        </Button>
      )}
    </div>
  );

  const editor = (
    <>
      {openFailed && <p className="text-sm text-destructive">Couldn't open the letter. Try again.</p>}
      {saveFailed && <p className="text-sm text-destructive">Couldn't download the letter. Try again.</p>}
      {editing && (
        <div className="space-y-2">
          <Textarea
            aria-label="Cover letter text"
            className="min-h-56 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={update.isPending || !text.trim() || tooLong}
              onClick={() => update.mutate({ id, edited_content: text }, { onSuccess: () => setText(null) })}
            >
              {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save and remake the PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setText(null)}>
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">{words} words</span>
          </div>
          {tooLong && <p className="text-sm text-destructive">That's too long for a cover letter.</p>}
          {update.isError && <p className="text-sm text-destructive">Couldn't save that. Try again.</p>}
        </div>
      )}
      {viewer}
    </>
  );
  return { buttons, editor };
}

/**
 * One cover letter, shaped like a résumé row (spec 039): its name and date,
 * then View (in the app), Download and Edit text. The same row on the job
 * page, the application page and Settings.
 */
export function CoverLetterRow({ id, filename, sub }: { id: string; filename: string; sub?: string }) {
  const { buttons, editor } = useLetterActions(id, filename);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-1.5">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="break-words text-sm">{filename}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {buttons}
      </div>
      {editor}
    </div>
  );
}

/**
 * "Write your own" (spec 040): type or paste a letter, and it is this job's,
 * its PDF drawn like Claude's, so Job Catcher attaches it. No AI, no Docs.
 */
function WriteLetter({ savedJobId, replaces }: { savedJobId: string; replaces: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const write = useWriteJobCoverLetter();
  if (text === null) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 pointer-coarse:h-11"
        onClick={() => {
          write.reset();
          setText("");
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Write your own
      </Button>
    );
  }
  const tooLong = text.length > MAX_CHARS;
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Your cover letter"
        placeholder="Type or paste your cover letter. Your name and contact go on top by themselves."
        className="min-h-56 text-sm"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      {replaces && (
        <p className="text-xs text-muted-foreground">
          It becomes this job's letter in place of the one above (that one stays in Settings).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5 pointer-coarse:h-11"
          disabled={write.isPending || !text.trim() || tooLong}
          onClick={() => write.mutate({ savedJobId, text }, { onSuccess: () => setText(null) })}
        >
          {write.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save for this job
        </Button>
        <Button size="sm" variant="ghost" className="pointer-coarse:h-11" onClick={() => setText(null)}>
          Cancel
        </Button>
      </div>
      {tooLong && <p className="text-sm text-destructive">That's too long for a cover letter.</p>}
      {write.isError && <p className="text-sm text-destructive">Couldn't save that. Try again.</p>}
    </div>
  );
}

/**
 * "Cover letter for this job" (spec 031; spec 039 made it always there): the
 * letter Job Catcher attaches to a cover-letter upload box, or pastes into a
 * cover-letter text box, on this job's application. View it, download it,
 * change its text, or pick another (or None). With no letter yet it says so.
 *
 * On the application page (`bare`, inside its card) the run's `letter` (null
 * = none) stands in until the saved jobs are in.
 */
export function JobCoverLetterPicker({
  jobListingId,
  company,
  letter,
  bare = false,
}: {
  jobListingId: string;
  /** The job's company, for the file name. */
  company?: string | null;
  letter?: { id: string; filename: string } | null;
  bare?: boolean;
}) {
  const { data: saved } = useSavedJobs();
  const { data: listed, isError: listFailed } = useCoverLetters();
  const letters = listed ?? [];
  const setLetter = useSetJobCoverLetter();
  const job = saved?.find((sj) => sj.job_listing_id === jobListingId);
  // Not a saved job (and no run to speak for it): nothing to show.
  if (!job && letter === undefined) return null;
  // Nothing until the letters are in: never a flash of "None yet".
  if (listed === undefined && !listFailed) return null;
  const chosen = job ? (job.cover_letter_id ?? "") : (letter?.id ?? "");
  const picked = letters.find((l) => l.id === chosen);
  // This job's own letters first, then the others (newest first in each).
  const ordered = [
    ...letters.filter((l) => l.job_listing_id === jobListingId),
    ...letters.filter((l) => l.job_listing_id !== jobListingId),
  ];
  const own = !picked || picked.job_listing_id === jobListingId;
  const filename = letterFileName(own ? company || picked?.company : picked?.company);
  const sub = picked && (own ? `Written ${day(picked.created_at)}` : `Written for ${labelOf(picked, jobListingId)}`);

  return (
    <section className={cn("space-y-3", !bare && "rounded-lg border p-4")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {!bare && <p className="text-sm font-medium">Cover letter for this job</p>}
          <p className="text-xs text-muted-foreground">Job Catcher attaches it, or pastes it into a cover-letter box.</p>
          {setLetter.isError && <p className="text-xs text-destructive">Couldn't save that. Try again.</p>}
        </div>
        {job && letters.length > 0 && (
          <select
            aria-label="Cover letter for this job"
            className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base sm:w-56"
            value={chosen}
            disabled={setLetter.isPending}
            onChange={(e) => setLetter.mutate({ savedJobId: job.id, coverLetterId: e.target.value || null })}
          >
            <option value="">None</option>
            {ordered.map((l) => (
              <option key={l.id} value={l.id}>
                {labelOf(l, jobListingId)}
              </option>
            ))}
          </select>
        )}
      </div>
      {chosen && (picked || letter) ? (
        <CoverLetterRow key={chosen} id={chosen} filename={filename} sub={sub || undefined} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {letters.length
            ? "None for this job: Job Catcher leaves the cover-letter box."
            : listFailed
              ? "Couldn't load your cover letters. Try again later."
              : job
                ? "None yet. Write your own, or Claude writes one when an application asks for it."
                : NO_LETTER_YET}
        </p>
      )}
      {job && <WriteLetter savedJobId={job.id} replaces={!!chosen} />}
    </section>
  );
}
