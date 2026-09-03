import { useState } from "react";
import { FileText, Copy, Check, Download, Loader2, ChevronDown, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadDocumentPdf } from "@/lib/downloadDocumentPdf";
import { useJobDocuments } from "@/hooks/useAI";
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

  const text = docText(doc);
  const fromClaude = doc.model_used === CLAUDE_MODEL;

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
          {/* Generous max height so it reads on a phone without swallowing the dialog. */}
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {text}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy} className="flex-1 sm:flex-none">
              {copied ? (
                <Check className="mr-1 h-4 w-4" aria-hidden />
              ) : (
                <Copy className="mr-1 h-4 w-4" aria-hidden />
              )}
              {copied ? "Copied" : "Copy text"}
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
        </div>
      )}
    </div>
  );
}

/**
 * The résumés and cover letters saved for one job — whether the app generated
 * them or Claude wrote them through the MCP connector. This is the read side of
 * `save_draft`: without it a draft Claude writes is stored but invisible.
 */
export function JobDocuments({ jobListingId }: { jobListingId: string | null | undefined }) {
  const { data: docs = [], isLoading, isError } = useJobDocuments(jobListingId);

  // A failed fetch must not look like "Claude never saved anything" — say so,
  // otherwise a broken request is indistinguishable from an empty list.
  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn't load saved documents for this job.
      </p>
    );
  }

  if (isLoading || docs.length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
        Documents ({docs.length})
      </p>
      <div className="space-y-2">
        {docs.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
}
