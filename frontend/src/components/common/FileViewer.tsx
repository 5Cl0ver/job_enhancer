import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PdfViewer } from "@/components/common/PdfViewer";
import { api } from "@/lib/api";

/** One of the user's own files: the API path it's served from, and its name. */
export type ViewFile = { path: string; filename: string };

/**
 * A file shown in the app (spec 025): a box on a computer, a tall sheet on a
 * phone. Files are the user's own, so they're fetched with the sign-in token
 * (never a token in a link) and drawn from memory. Fetched fresh each time:
 * editing a job's résumé remakes its PDF under the same address.
 */
export function FileViewerDialog({ file, onClose }: { file: ViewFile | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["view-file", file?.path],
    queryFn: () => api.getBlob(file!.path),
    enabled: !!file,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95dvh] max-w-4xl flex-col p-3 sm:p-4 md:h-[92vh] max-md:h-[92dvh]">
        <DialogTitle className="truncate pr-8 text-sm">{file?.filename}</DialogTitle>
        <DialogDescription className="sr-only">The file, shown here. Download it from the button.</DialogDescription>
        {q.data && file ? (
          // On a phone the sheet's body is a grid, so the viewer gets the
          // sheet's height itself: the zoom and Download bar stays in view.
          <PdfViewer
            blob={q.data}
            filename={file.filename}
            className="min-h-0 flex-1 max-md:h-[calc(92dvh-6rem)]"
          />
        ) : q.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">Couldn't open this file.</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => q.refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden /> Try again
            </Button>
          </div>
        ) : (
          <p className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `view(file)` opens the viewer; render `viewer` once in the component. */
export function useFileViewer() {
  const [file, setFile] = useState<ViewFile | null>(null);
  return {
    view: setFile,
    viewer: <FileViewerDialog file={file} onClose={() => setFile(null)} />,
  };
}

/** A saved résumé's file. */
export const resumeFile = (id: string, filename?: string | null): ViewFile => ({
  path: `/v1/ai/resumes/${id}/file`,
  filename: filename || "Résumé",
});

/** A written document (résumé or cover letter) as a PDF. */
export const documentFile = (id: string, filename: string): ViewFile => ({
  path: `/v1/ai/documents/${id}/pdf`,
  filename,
});
