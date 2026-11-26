import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const getBlob = vi.fn();
const getDocument = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: vi.fn(),
    getBlob: (...a: unknown[]) => getBlob(...a),
  },
  ApiError: class extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

vi.mock("@/lib/pdfjs", () => ({ loadPdfjs: () => Promise.resolve({ getDocument }) }));

import { CoverLetterCard, JobCoverLetterPicker } from "@/components/jobs/JobCoverLetterPicker";

const LETTER = "The Platform Engineer role at Northwind Labs fits what I do.\n\nThanks for your time,\nAlex Rivera";
const letters = [
  { id: "cl1", job_listing_id: "l1", job_title: "Platform Engineer", company: "Northwind Labs", created_at: "2026-11-25T10:00:00Z" },
  { id: "cl2", job_listing_id: "l9", job_title: "SRE", company: "Contoso", created_at: "2026-11-20T10:00:00Z" },
];
const listing = { id: "l1", title: "Platform Engineer", company: "Northwind Labs", location: "Remote", description: "" };
let savedJobs: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  savedJobs = [{ id: "s1", job_listing_id: "l1", cover_letter_id: "cl1", job_listing: listing }];
  get.mockImplementation((path: string) => {
    if (path === "/v1/ai/cover-letters") return Promise.resolve(letters);
    if (path.startsWith("/v1/saved-jobs")) return Promise.resolve(savedJobs);
    if (path === "/v1/ai/documents/cl1")
      return Promise.resolve({ id: "cl1", document_type: "cover_letter", content: LETTER, edited_content: null });
    return Promise.resolve([]);
  });
  put.mockResolvedValue(null);
  patch.mockImplementation((_p: string, body: { edited_content: string }) =>
    Promise.resolve({ id: "cl1", document_type: "cover_letter", content: LETTER, edited_content: body.edited_content }),
  );
  getBlob.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
          render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        }),
    }),
    destroy: () => Promise.resolve(),
  });
});

function renderIt(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Cover letter for this job", () => {
  it("shows the job's pick, this job's letters first, and None", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    const select = await screen.findByRole("combobox", { name: "Cover letter for this job" });
    await waitFor(() => expect(select).toHaveValue("cl1"));
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options[0]).toBe("None");
    expect(options[1]).toMatch(/^For this job · /);
    expect(options[2]).toMatch(/^Contoso · /);
  });

  it("picks another letter, or None", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    const select = await screen.findByRole("combobox", { name: "Cover letter for this job" });
    await waitFor(() => expect(select).toHaveValue("cl1"));
    await userEvent.selectOptions(select, "cl2");
    await waitFor(() => expect(put).toHaveBeenCalledWith("/v1/saved-jobs/s1/cover-letter", { cover_letter_id: "cl2" }));
    await userEvent.selectOptions(select, "");
    await waitFor(() => expect(put).toHaveBeenCalledWith("/v1/saved-jobs/s1/cover-letter", { cover_letter_id: null }));
  });

  it("views the letter in the app", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await userEvent.click(await screen.findByRole("button", { name: "View Cover letter" }));
    expect(await screen.findByRole("img", { name: "Page 1 of 1" })).toBeInTheDocument();
    expect(getBlob).toHaveBeenCalledWith("/v1/ai/documents/cl1/pdf");
  });

  it("edits the text, which remakes the PDF", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await userEvent.click(await screen.findByRole("button", { name: /Edit text/ }));
    const box = await screen.findByLabelText("Cover letter text");
    expect(box).toHaveValue(LETTER);
    await userEvent.clear(box);
    await userEvent.type(box, "A shorter letter.");
    expect(screen.getByText("3 words")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save and remake the PDF/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/ai/documents/cl1", { edited_content: "A shorter letter." }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Cover letter text")).toBeNull());
  });

  it("no pick: no View or Edit, just the choice", async () => {
    savedJobs = [{ id: "s1", job_listing_id: "l1", cover_letter_id: null, job_listing: listing }];
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    const select = await screen.findByRole("combobox", { name: "Cover letter for this job" });
    expect(select).toHaveValue("");
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
  });

  it("hidden until there's a cover letter", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/v1/saved-jobs") ? savedJobs : []),
    );
    const { container } = renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/ai/cover-letters"));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the application page's cover-letter card", () => {
  it("names the letter, views it and edits it", async () => {
    renderIt(<CoverLetterCard letter={{ id: "cl1", filename: "Alex Rivera - Cover letter.pdf" }} />);
    expect(screen.getByText("Alex Rivera - Cover letter.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View Alex Rivera - Cover letter.pdf" }));
    expect(await screen.findByRole("img", { name: "Page 1 of 1" })).toBeInTheDocument();
    expect(getBlob).toHaveBeenCalledWith("/v1/ai/documents/cl1/pdf");
  });
});
