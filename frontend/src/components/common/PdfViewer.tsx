import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPdfjs, type PDFDocumentProxy } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";

// Zoom steps, as a share of the viewer's width (1 = the page fits the width).
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3];
const FIT = ZOOMS.indexOf(1);
// A phone browser drops canvases past ~16M pixels; stay well under, even
// zoomed in on a 3x screen.
const MAX_PIXELS = 8_000_000;

/** A PDF by its type, its name, or (a file saved without either) its header. */
async function isPdf(blob: Blob, filename: string): Promise<boolean> {
  if (blob.type === "application/pdf" || /\.pdf$/i.test(filename)) return true;
  if (blob.type && blob.type !== "application/octet-stream") return false;
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

/** Hand the browser the file to save. The URL is freed later, not at once:
 * some browsers (phone Safari among them) read it after the click returns. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function PdfPage({
  doc,
  n,
  width,
  onError,
}: {
  doc: PDFDocumentProxy;
  n: number;
  width: number;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Letter-shaped until the page says its own size, so the list doesn't jump.
  const [height, setHeight] = useState(Math.round((width * 11) / 8.5));

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const el = canvas.current;
      if (cancelled || !el) return;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      // Sharp on phones: draw at the screen's pixel density (capped for memory).
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const ratio = Math.min(dpr, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
      el.width = Math.floor(viewport.width * ratio);
      el.height = Math.floor(viewport.height * ratio);
      setHeight(Math.floor(viewport.height));
      task = page.render({
        canvas: el,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await task.promise;
    })().catch((e: unknown) => {
      // A zoom or close cancels the drawing in progress; that's not an error.
      if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") onError();
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width, onError]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={`Page ${n} of ${doc.numPages}`}
      className="mx-auto block bg-white shadow-sm ring-1 ring-black/10"
      style={{ width, height }}
    />
  );
}

/**
 * A PDF drawn in the app, page by page (spec 025): phones download a PDF
 * link instead of showing it, so the pages are drawn on canvases with PDF.js,
 * which works the same on every browser. Zoom in and out; Download is always
 * there. A file that isn't a PDF (a Word résumé) shows a note and Download.
 */
export function PdfViewer({
  blob,
  filename,
  className,
}: {
  blob: Blob;
  filename: string;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-pdf" | "error">("loading");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(FIT);
  const [width, setWidth] = useState(0);
  const onError = useCallback(() => setState("error"), []);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setState("loading");
    setDoc(null);
    (async () => {
      if (!(await isPdf(blob, filename))) {
        if (!cancelled) setState("not-pdf");
        return;
      }
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (cancelled) return; // closed while reading: never start a worker
      const loadingTask = pdfjs.getDocument({ data });
      task = loadingTask;
      const loaded = await loadingTask.promise;
      if (cancelled) {
        void loadingTask.destroy(); // closed while parsing: free the worker
        return;
      }
      setDoc(loaded);
      setState("ready");
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
      void task?.destroy(); // frees the worker's copy of the file
    };
  }, [blob, filename]);

  // Pages are as wide as the viewer (times the zoom), so a phone shows the
  // whole width of the page and a computer doesn't show a postage stamp.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(el.clientWidth - 24, 0));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.round((width || 600) * ZOOMS[zoom]);
  const download = () => saveBlob(blob, filename);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-1">
        {state === "ready" && doc && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              disabled={zoom === 0}
              onClick={() => setZoom((z) => Math.max(z - 1, 0))}
            >
              <ZoomOut className="h-4 w-4" aria-hidden />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {Math.round(ZOOMS[zoom] * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              disabled={zoom === ZOOMS.length - 1}
              onClick={() => setZoom((z) => Math.min(z + 1, ZOOMS.length - 1))}
            >
              <ZoomIn className="h-4 w-4" aria-hidden />
            </Button>
            <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
              {doc.numPages === 1 ? "1 page" : `${doc.numPages} pages`}
            </span>
          </>
        )}
        {(state === "loading" || state === "ready") && (
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={download}>
            <Download className="h-4 w-4" aria-hidden /> Download
          </Button>
        )}
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg bg-muted/60 p-3"
        data-testid="pdf-pages"
      >
        {state === "loading" && (
          <p className="flex h-full min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening…
          </p>
        )}
        {(state === "not-pdf" || state === "error") && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-4 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm">
              {state === "not-pdf"
                ? "This file can't be shown here. Download it to open it."
                : "Couldn't show this file. Download it to open it."}
            </p>
            <Button size="sm" className="gap-1.5" onClick={download}>
              <Download className="h-4 w-4" aria-hidden /> Download {filename}
            </Button>
          </div>
        )}
        {state === "ready" && doc && (
          <div className="flex w-max min-w-full flex-col items-center gap-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} n={i + 1} width={pageWidth} onError={onError} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
