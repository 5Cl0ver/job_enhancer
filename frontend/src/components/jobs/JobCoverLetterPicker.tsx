import { useState } from "react";
import { Eye, Loader2, Mail, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { documentFile, useFileViewer } from "@/components/common/FileViewer";
import { useUpdateDocument } from "@/hooks/useAI";
import { useCoverLetters, useSetJobCoverLetter, type CoverLetterItem } from "@/hooks/useCoverLetters";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { api } from "@/lib/api";
import type { GeneratedDocument } from "@/types/api";

const MAX_CHARS = 10_000;

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "For this job · Nov 25", or the job it was written for. */
function labelOf(letter: CoverLetterItem, jobListingId: string) {
  if (letter.job_listing_id === jobListingId) return `For this job · ${day(letter.created_at)}`;
  return `${letter.company || letter.job_title || "Another job"} · ${day(letter.created_at)}`;
}

/**
 * View a cover letter in the app, and change its text (the PDF is drawn from
 * the text, so it's remade). Returns the buttons and the editor separately,
 * so the editor can take the card's full width.
 */
function useLetterActions(id: string, filename: string) {
  const [text, setText] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
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
  const tooLong = (text ?? "").length > MAX_CHARS;
  const words = (text ?? "").trim() ? (text ?? "").trim().split(/\s+/).length : 0;

  const buttons = (
    <div className="flex shrink-0 gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 pointer-coarse:h-11"
        aria-label={`View ${filename}`}
        onClick={() => view(documentFile(id, filename))}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden /> View
      </Button>
      {!editing && (
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 pointer-coarse:h-11"
          disabled={opening}
          onClick={edit}
        >
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

function LetterRow({
  id,
  filename,
  children,
}: {
  id: string;
  filename: string;
  children: (buttons: React.ReactNode) => React.ReactNode;
}) {
  const { buttons, editor } = useLetterActions(id, filename);
  return (
    <>
      {children(buttons)}
      {editor}
    </>
  );
}

/**
 * "Cover letter for this job" (spec 031): the letter Job Catcher attaches to a
 * cover-letter upload box, or pastes into a cover-letter text box, on this
 * job's application. Pick one, view it, change its text, or None. Hidden until
 * the user has a cover letter (Claude writes one when an application asks).
 */
export function JobCoverLetterPicker({ jobListingId }: { jobListingId: string }) {
  const { data: saved } = useSavedJobs();
  const { data: letters = [] } = useCoverLetters();
  const setLetter = useSetJobCoverLetter();
  const job = saved?.find((sj) => sj.job_listing_id === jobListingId);
  if (!job || letters.length === 0) return null;
  const chosen = job.cover_letter_id ?? "";
  // This job's own letters first, then the others (newest first in each).
  const ordered = [
    ...letters.filter((l) => l.job_listing_id === jobListingId),
    ...letters.filter((l) => l.job_listing_id !== jobListingId),
  ];
  const picked = letters.find((l) => l.id === chosen);

  const row = (buttons: React.ReactNode) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">Cover letter for this job</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Job Catcher attaches it, or pastes it into a cover-letter box.
        </p>
        {setLetter.isError && <p className="text-xs text-destructive">Couldn't save that. Try again.</p>}
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
        <select
          aria-label="Cover letter for this job"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base sm:w-56 sm:flex-none"
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
        {buttons}
      </div>
    </div>
  );

  return (
    <section className="space-y-3 rounded-lg border p-4">
      {picked ? (
        <LetterRow key={picked.id} id={picked.id} filename="Cover letter">
          {row}
        </LetterRow>
      ) : (
        row(null)
      )}
    </section>
  );
}

/**
 * The application page's small card (spec 031): the letter that goes with
 * this application, to view or change. Picking another is on the job's page.
 */
export function CoverLetterCard({ letter }: { letter: { id: string; filename: string } }) {
  return (
    <div className="space-y-3">
      <LetterRow key={letter.id} id={letter.id} filename={letter.filename}>
        {(buttons) => (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-sm">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{letter.filename}</span>
            </p>
            {buttons}
          </div>
        )}
      </LetterRow>
    </div>
  );
}
