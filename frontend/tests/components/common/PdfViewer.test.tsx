import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PDF.js is mocked: jsdom has no canvas, and the point here is what the viewer
// asks PDF.js to draw (every page, sized to the viewer, at the screen's density).
const render_ = vi.fn();
const getDocument = vi.fn();
const loadPdfjs = vi.fn();
vi.mock("@/lib/pdfjs", () => ({ loadPdfjs: () => loadPdfjs() }));

const getBlob = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { getBlob: (...a: unknown[]) => getBlob(...a) },
}));

import { PdfViewer } from "@/components/common/PdfViewer";
import { FileViewerDialog } from "@/components/common/FileViewer";

const page = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
  render: (params: unknown) => {
    render_(params);
    return { promise: Promise.resolve(), cancel: vi.fn() };
  },
};

function pdfDoc(numPages: number) {
  return { numPages, getPage: vi.fn().mockResolvedValue(page) };
}

const pdf = (name = "Résumé.pdf") => ({
  blob: new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }),
  filename: name,
});

const createObjectURL = vi.fn(() => "blob:fake");
const destroy = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  render_.mockReset();
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({ promise: Promise.resolve(pdfDoc(2)), destroy }));
  loadPdfjs.mockReset();
  loadPdfjs.mockResolvedValue({ getDocument });
  getBlob.mockReset();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PdfViewer", () => {
  it("draws every page in the app, nothing downloaded", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    render(<PdfViewer {...pdf()} />);
    expect(screen.getByText(/Opening/)).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Page 1 of 2" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Page 2 of 2" })).toBeInTheDocument();
    await waitFor(() => expect(render_).toHaveBeenCalledTimes(2));
    expect(getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array);
    expect(click).not.toHaveBeenCalled();
  });

  it("sizes pages to the viewer and draws sharp on a phone screen", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    render(<PdfViewer {...pdf()} />);
    await waitFor(() => expect(render_).toHaveBeenCalled());
    const { canvas, viewport, transform } = render_.mock.calls[0][0];
    // jsdom has no layout, so the viewer falls back to 600px wide.
    expect(viewport.width).toBe(600);
    expect(canvas.width).toBe(1800);
    expect(transform).toEqual([3, 0, 0, 3, 0, 0]);
  });

  it("zooms in and out", async () => {
    const user = userEvent.setup();
    render(<PdfViewer {...pdf()} />);
    await waitFor(() => expect(render_).toHaveBeenCalledTimes(2));
    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await waitFor(() => expect(render_.mock.calls.at(-1)![0].viewport.width).toBe(750));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });

  it("Download saves the file under its name", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const file = pdf("Sam - Résumé.pdf");
    render(<PdfViewer {...file} />);
    await user.click(screen.getByRole("button", { name: /Download/ }));
    expect(createObjectURL).toHaveBeenCalledWith(file.blob);
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toBe("Sam - Résumé.pdf");
  });

  it("a Word file says it can't be shown, with Download", async () => {
    const docx = new Blob(["PK"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    render(<PdfViewer blob={docx} filename="resume.docx" />);
    expect(
      await screen.findByText("This file can't be shown here. Download it to open it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download resume.docx" })).toBeInTheDocument();
    expect(loadPdfjs).not.toHaveBeenCalled();
  });

  it("a file PDF.js can't read says so, with Download", async () => {
    getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error("bad")), destroy }));
    render(<PdfViewer {...pdf()} />);
    expect(await screen.findByText(/Couldn't show this file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Résumé.pdf" })).toBeInTheDocument();
  });

  it("frees the file when closed", async () => {
    const { unmount } = render(<PdfViewer {...pdf()} />);
    await screen.findByRole("img", { name: "Page 1 of 2" });
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("FileViewerDialog", () => {
  function renderDialog(file: { path: string; filename: string } | null) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <FileViewerDialog file={file} onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("fetches the file with the sign-in token (not a link) and shows it", async () => {
    getBlob.mockResolvedValue(pdf().blob);
    renderDialog({ path: "/v1/ai/resumes/r1/file", filename: "Résumé.pdf" });
    expect(screen.getByRole("dialog")).toHaveTextContent("Résumé.pdf");
    expect(await screen.findByRole("img", { name: "Page 1 of 2" })).toBeInTheDocument();
    expect(getBlob).toHaveBeenCalledWith("/v1/ai/resumes/r1/file");
  });

  it("says when the file couldn't be fetched", async () => {
    getBlob.mockRejectedValue(new Error("404"));
    renderDialog({ path: "/v1/ai/resumes/r1/file", filename: "Résumé.pdf" });
    expect(await screen.findByText("Couldn't open this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("is closed with no file", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getBlob).not.toHaveBeenCalled();
  });
});
