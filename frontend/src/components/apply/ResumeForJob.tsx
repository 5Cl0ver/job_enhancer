import { useEffect, useState } from "react";
import { Eye, FileText, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { JobResumePicker } from "@/components/jobs/JobResumePicker";
import { useGeneratedDocument, useResumes, useUpdateDocument } from "@/hooks/useAI";
import { resumeFile, useFileViewer } from "@/components/common/FileViewer";
import type { ApplyRun } from "@/lib/apply";

/**
 * The résumé Claude made for this job: view the PDF in the app, edit its text (the PDF is
 * remade, and that's what Job Catcher uploads), or switch the job to any other
 * résumé. Open at every step, before, during and after the application.
 */
export function ResumeForJob({ run }: { run: ApplyRun }) {
  const { data: resumes = [] } = useResumes({ withMade: true });
  const { data: doc } = useGeneratedDocument(run.document_id);
  const update = useUpdateDocument();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const resume = resumes.find((r) => r.id === run.resume_id);
  const { view, viewer } = useFileViewer();

  useEffect(() => {
    if (doc && !editing) setText(doc.edited_content ?? doc.content);
  }, [doc, editing]);

  if (!run.resume_id) return null;
  const save = () =>
    update.mutate(
      { id: run.document_id!, edited_content: text },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{resume?.filename ?? "Résumé for this job"}</span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => view(resumeFile(run.resume_id!, resume?.filename))}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden /> View
          </Button>
          {run.document_id && !editing && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit text
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="space-y-2">
          <Textarea
            aria-label="Résumé text"
            className="min-h-72 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={update.isPending} className="gap-1.5">
              {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save and remake the PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {update.isError && <p className="text-sm text-destructive">Couldn't save that. Try again.</p>}
        </div>
      )}
      <JobResumePicker jobListingId={run.job.listing_id} />
      {viewer}
    </div>
  );
}
