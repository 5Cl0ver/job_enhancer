import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { CoverLetterRow, JobCoverLetterPicker } from "@/components/jobs/JobCoverLetterPicker";
import { CoverLettersCard } from "@/components/settings/CoverLettersCard";

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

afterEach(() => vi.restoreAllMocks());

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

  it("shows the letter like a résumé: its name, when, View, Download, Edit text", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" company="Northwind Labs" />);
    expect(await screen.findByText("Cover letter - Northwind Labs.pdf")).toBeInTheDocument();
    expect(screen.getByText(/^Written /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Cover letter - Northwind Labs.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit text/ })).toBeInTheDocument();
  });

  it("views the letter in the app", async () => {
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await userEvent.click(await screen.findByRole("button", { name: "View Cover letter - Northwind Labs.pdf" }));
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

  it("always there: with no letter yet it says so (spec 039)", async () => {
    savedJobs = [{ id: "s1", job_listing_id: "l1", cover_letter_id: null, job_listing: listing }];
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/v1/saved-jobs") ? savedJobs : []),
    );
    renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    expect(await screen.findByText("None yet. Claude writes one when an application asks for it.")).toBeInTheDocument();
    expect(screen.getByText("Cover letter for this job")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
  });

  it("says nothing until the letters are in (no flash of None yet)", async () => {
    let letGo: (v: unknown) => void = () => {};
    get.mockImplementation((path: string) => {
      if (path === "/v1/ai/cover-letters") return new Promise((r) => (letGo = r));
      return Promise.resolve(path.startsWith("/v1/saved-jobs") ? savedJobs : []);
    });
    const { container } = renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/ai/cover-letters"));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/v1\/saved-jobs/)));
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    letGo(letters);
    expect(await screen.findByText("Cover letter - Northwind Labs.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/None yet/)).toBeNull();
  });

  it("not on a job that isn't saved", async () => {
    savedJobs = [];
    const { container } = renderIt(<JobCoverLetterPicker jobListingId="l1" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/ai/cover-letters"));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the cover-letter row", () => {
  it("names the letter and views it", async () => {
    renderIt(<CoverLetterRow id="cl1" filename="Cover letter - Northwind Labs.pdf" sub="Written Nov 25" />);
    expect(screen.getByText("Cover letter - Northwind Labs.pdf")).toBeInTheDocument();
    expect(screen.getByText("Written Nov 25")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View Cover letter - Northwind Labs.pdf" }));
    expect(await screen.findByRole("img", { name: "Page 1 of 1" })).toBeInTheDocument();
    expect(getBlob).toHaveBeenCalledWith("/v1/ai/documents/cl1/pdf");
  });

  it("downloads it under its readable name", async () => {
    URL.createObjectURL = vi.fn(() => "blob:letter");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderIt(<CoverLetterRow id="cl1" filename="Cover letter - Northwind Labs.pdf" />);
    await userEvent.click(screen.getByRole("button", { name: "Download Cover letter - Northwind Labs.pdf" }));
    await waitFor(() => expect(names).toEqual(["Cover letter - Northwind Labs.pdf"]));
    expect(getBlob).toHaveBeenCalledWith("/v1/ai/documents/cl1/pdf");
  });
});

describe("Settings › Cover letters", () => {
  it("lists every letter, newest first, with the same row", async () => {
    renderIt(<CoverLettersCard />);
    expect(await screen.findByText("Cover letter - Northwind Labs.pdf")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Cover letters" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Cover letter - Contoso.pdf")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/^Platform Engineer · /)).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: /Edit text/ })).toBeInTheDocument();
  });

  it("says nothing until the letters are in", async () => {
    get.mockImplementation(() => new Promise(() => {}));
    renderIt(<CoverLettersCard />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/ai/cover-letters"));
    expect(screen.getByText("Cover letters")).toBeInTheDocument();
    expect(screen.queryByText(/None yet/)).toBeNull();
  });

  it("says none yet when there are none", async () => {
    get.mockResolvedValue([]);
    renderIt(<CoverLettersCard />);
    expect(await screen.findByText("None yet. Claude writes one when an application asks for it.")).toBeInTheDocument();
  });
});
