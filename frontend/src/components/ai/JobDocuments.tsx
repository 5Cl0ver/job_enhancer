import { useState } from "react";
import {
  FileText,
  Copy,
  Check,
  Download,
  Loader2,
  ChevronDown,
  Sparkles,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadDocumentPdf } from "@/lib/downloadDocumentPdf";
import { useJobDocuments, useUpdateDocument } from "@/hooks/useAI";
import { cn } from "@/lib/utils";
import type { GeneratedDocument } from "@/types/api";

const LABEL: Record<string, string> = {
  resume: "Résumé",
  cover_letter: "Cover letter",
};

/** Documents written by the connector carry this marker (see mcp_server.save_draft). */
const CLAUDE_MODEL = "claude-connector";

function docText(doc: GeneratedDocument) {
  return doc.edited_content?.trim() || doc.content;
}

function DocumentRow({ doc }: { doc: GeneratedDocument }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const updateDoc = useUpdateDocument();
  const text = docText(doc);
  const fromClaude = doc.model_used === CLAUDE_MODEL;
  const isEdited = !!doc.edited_content?.trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure context / permission) — the text is still on screen */
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadDocumentPdf(doc.id, `${doc.document_type}-${doc.id}.pdf`);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  const startEditing = () => {
    setDraft(text);
    updateDoc.reset(); // don't greet the user with the previous attempt's error
    setEditing(true);
  };

  const cancelEditing = () => {
    updateDoc.reset();
    setEditing(false);
  };

  const save = () => {
    updateDoc.mutate(
      { id: doc.id, edited_content: draft },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {LABEL[doc.document_type] ?? doc.document_type}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {format(new Date(doc.created_at), "MMM d, h:mm a")}
            {isEdited && " · edited"}
          </span>
        </span>
        {fromClaude && (
          <Badge variant="secondary" className="shrink-0 gap-1 text-[11px]">
            <Sparkles className="h-3 w-3" aria-hidden /> Claude
          </Badge>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-2.5">
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={16}
                className="w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-relaxed"
                aria-label={`Edit ${LABEL[doc.document_type] ?? doc.document_type}`}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={save}
                  disabled={updateDoc.isPending || !draft.trim()}
                >
                  {updateDoc.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Save changes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={updateDoc.isPending}
                >
                  Cancel
                </Button>
              </div>
              {!draft.trim() && (
                <p className="text-xs text-muted-foreground">
                  A document can't be saved empty.
                </p>
              )}
              {updateDoc.isError && (
                <p className="text-xs text-destructive">Couldn't save. Try again.</p>
              )}
            </>
          ) : (
            <>
              {/* Generous max height so it reads on a phone without swallowing the page. */}
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {text}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={startEditing} className="flex-1 sm:flex-none">
                  <Pencil className="mr-1 h-4 w-4" aria-hidden />
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={copy} className="flex-1 sm:flex-none">
                  {copied ? (
                    <Check className="mr-1 h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="mr-1 h-4 w-4" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadPdf}
                  disabled={downloading}
                  className="flex-1 sm:flex-none"
                >
                  {downloading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="mr-1 h-4 w-4" aria-hidden />
                  )}
                  {downloading ? "Preparing…" : "PDF"}
                </Button>
              </div>
              {downloadError && (
                <p className="text-xs text-destructive">Couldn't build the PDF. Try again.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The résumés and cover letters saved for one job — whether the app generated
 * them or Claude wrote them through the MCP connector (`save_draft`). This is
 * the read side of that tool: without it a draft Claude writes is stored but
 * invisible.
 *
 * The heading renders even with nothing saved, on purpose: an empty section
 * that names itself tells you where documents will appear, where a component
 * that returns null just looks like the feature doesn't exist.
 */
export function JobDocuments({
  jobListingId,
  compact = false,
}: {
  jobListingId: string | null | undefined;
  /** Match the dialog's smaller section labels instead of the page's headings. */
  compact?: boolean;
}) {
  const { data: docs = [], isLoading, isError } = useJobDocuments(jobListingId);

  // No job to ask about — the query never ran, so claiming "nothing saved yet"
  // would be asserting something we never checked.
  if (!jobListingId) return null;

  // Only surface the error state when there's nothing cached to show. A failed
  // background refetch must not blow away the list — that would unmount the rows
  // and throw away an edit in progress along with its unsaved draft.
  const showError = isError && docs.length === 0;

  return (
    <div className="space-y-2">
      <h2
        className={cn(
          compact ? "text-xs font-semibold text-muted-foreground" : "text-lg font-semibold",
        )}
      >
        Documents{docs.length > 0 && ` (${docs.length})`}
      </h2>

      {isLoading ? (
        <p className={cn(compact ? "text-xs" : "text-sm", "text-muted-foreground")}>Loading…</p>
      ) : showError ? (
        // A failed fetch must not look like "nothing saved yet" — say what happened.
        <p className={cn(compact ? "text-xs" : "text-sm", "text-destructive")}>
          Couldn't load saved documents for this job.
        </p>
      ) : docs.length === 0 ? (
        <p className={cn(compact ? "text-xs" : "text-sm", "text-muted-foreground")}>
          No résumé or cover letter saved for this job yet. Generate one from this job,
          or ask Claude to tailor one through the connector — either way it appears here
          to read, edit, or download.
        </p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}
