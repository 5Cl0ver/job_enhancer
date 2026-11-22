import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn(),
    patch: (...args: unknown[]) => patch(...args),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ApiError } from "@/lib/api";
import { NameCheck, NameCheckLine, RenameButton, RenameJob } from "@/components/jobs/RenameJob";
import type { SavedJob } from "@/types/api";

const JOB = {
  id: "s1",
  job_listing_id: "l1",
  origin: "email",
  name_doubtful: true,
  job_listing: {
    id: "l1",
    title: "next phase of our recruitment process in the Platform Engineer",
    company: "Wren Calloway",
    location: "Not specified",
    apply_url: "https://mail.yahoo.com/d/folders/1/messages/abc",
  },
} as unknown as SavedJob;

function show(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    // The form shows the error itself (as ScoutStart's tests do).
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}


describe("fixing a job's name", () => {
  it("flags a name read from an email that looks wrong, and fixes it", async () => {
    patch.mockResolvedValue({ ...JOB, job_listing_id: "l1" });
    const user = userEvent.setup();
    show(<NameCheck savedJob={JOB} />);
    expect(screen.getByText(/read from an email and may be wrong/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fix the name" }));
    const form = await screen.findByRole("dialog");
    const title = within(form).getByLabelText("Job title");
    expect(title).toHaveValue(JOB.job_listing.title);
    // The place "Not specified" and the email link aren't offered as values.
    expect(within(form).getByLabelText("Place")).toHaveValue("");
    expect(within(form).getByLabelText("Posting link (optional)")).toHaveValue("");

    await user.clear(title);
    await user.type(title, "Platform Engineer");
    const company = within(form).getByLabelText("Company");
    await user.clear(company);
    await user.type(company, "Vellacor");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    // Only what changed: the place stays the posting's own.
    expect(patch).toHaveBeenCalledWith("/v1/saved-jobs/s1/listing", {
      title: "Platform Engineer",
      company: "Vellacor",
    });
  });

  it("'Looks right' keeps the name and stops asking", async () => {
    patch.mockResolvedValue({ ...JOB, name_doubtful: false, renamed: true });
    show(<NameCheck savedJob={JOB} />);
    await userEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(patch).toHaveBeenCalledWith("/v1/saved-jobs/s1/listing", {
      title: JOB.job_listing.title,
      company: JOB.job_listing.company,
    });
  });

  it("keeps the current link when the link is left empty, and says so", async () => {
    patch.mockResolvedValue(JOB);
    show(<RenameButton savedJob={{ ...JOB, origin: "manual" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const form = await screen.findByRole("dialog");
    const link = within(form).getByLabelText("Link");
    expect(link).toHaveValue(JOB.job_listing.apply_url);
    await userEvent.clear(link);
    expect(within(form).getByText("Empty keeps the current link.")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(patch.mock.calls.at(-1)?.[1]).not.toHaveProperty("apply_url");
  });

  it("says so when saving fails, and keeps the form", async () => {
    patch.mockRejectedValue(
      new ApiError(422, JSON.stringify({ detail: "The link must start with http:// or https://" })),
    );
    show(<RenameJob savedJob={JOB} open onOpenChange={() => {}} />);
    const form = await screen.findByRole("dialog");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "The link must start with http:// or https://",
    );
  });

  it("won't save an empty title or a link that isn't a web address", async () => {
    patch.mockClear();
    const user = userEvent.setup();
    show(<RenameButton savedJob={JOB} />);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const form = await screen.findByRole("dialog");
    await user.clear(within(form).getByLabelText("Job title"));
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Add a title and a company.");
    await user.type(within(form).getByLabelText("Job title"), "Platform Engineer");
    await user.type(within(form).getByLabelText("Posting link (optional)"), "vellacor.example");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("http");
    expect(patch).not.toHaveBeenCalled();
  });

  it("shows nothing for a name that looks fine", () => {
    const { container } = show(
      <>
        <NameCheck savedJob={{ ...JOB, name_doubtful: false }} />
        <NameCheckLine savedJob={{ name_doubtful: false }} />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
