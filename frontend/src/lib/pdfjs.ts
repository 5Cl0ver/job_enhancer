import type * as PdfJs from "pdfjs-dist";

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

let loading: Promise<typeof PdfJs> | null = null;

/**
 * PDF.js (Mozilla), loaded only when a file is first shown, so it never
 * slows the app's first load. The legacy build carries its own polyfills, so
 * older phone browsers draw pages too. Its worker parses the file off the
 * main thread; `?url` makes Vite ship it as its own file.
 */
export function loadPdfjs(): Promise<typeof PdfJs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib as typeof PdfJs;
    })
    .catch((e) => {
      loading = null; // a dropped connection: try again next time
      throw e;
    });
  return loading;
}
