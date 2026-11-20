import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { PhoneJobList } from "@/components/jobs/PhoneJobList";

const STAGES = [
  { id: "applied", name: "Applied", color: null, sort_order: 0, is_default: true },
  { id: "interview", name: "Interview", color: null, sort_order: 1, is_default: true },
  { id: "offer", name: "Offer", color: null, sort_order: 2, is_default: true },
];

function saved(id: string, title: string, company: string, stage: string, remote = false) {
  return {
    id,
    pipeline_stage_id: stage,
    applied_at: null,
    job_listing: {
      id: `listing-${id}`,
      title,
      company,
      location: "Springfield, IL",
      is_remote: remote,
      is_expired: false,
      salary_min: null,
      salary_max: null,
      salary_period: null,
      job_type: null,
    },
  };
}

// 40 in Applied (more than one page) and 2 in Interview, one of them remote.
const JOBS = [
  ...Array.from({ length: 40 }, (_, i) => saved(`a${i}`, `Support Analyst ${i}`, "Vellacor", "applied")),
  saved("i1", "Jira Administrator", "Quillstone", "interview", true),
  saved("i2", "IT Systems Administrator", "Brambleworks", "interview"),
];

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PhoneJobList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/jobs/"));

beforeEach(() => {
  window.localStorage.clear();
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith("/v1/pipeline-stages")) return Promise.resolve(STAGES);
    if (path.startsWith("/v1/saved-jobs")) return Promise.resolve(JOBS);
    return Promise.resolve([]);
  });
});

describe("PhoneJobList", () => {
  it("draws one page of rows, each a link to its job, and offers the rest", async () => {
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(rows()[0]).toHaveAttribute("href", "/jobs/listing-a0");
    expect(screen.getByRole("button", { name: "Show more (12 left)" })).toBeInTheDocument();
  });

  it("shows a chip per stage that has jobs, with its count", async () => {
    renderList();
    expect(await screen.findByRole("button", { name: "All 42" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Applied 40" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Interview 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Offer/ })).not.toBeInTheDocument();
  });

  it("a stage chip shows only that stage, and is remembered", async () => {
    const user = userEvent.setup();
    const { unmount } = renderList();
    await user.click(await screen.findByRole("button", { name: "Interview 2" }));
    expect(rows()).toHaveLength(2);

    unmount();
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Interview 2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to All when the remembered stage is gone", async () => {
    window.localStorage.setItem("ui.jobsStage", "deleted-stage");
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(screen.getByRole("button", { name: "All 42" })).toHaveAttribute("aria-pressed", "true");
  });

  it("search narrows the rows and the chip counts", async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(await screen.findByLabelText("Search your jobs"), "quillstone");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "All 1" })).toBeInTheDocument();
  });

  it("the filter sheet says how many jobs it will show, and Clear undoes it", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole("button", { name: /Filters/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Show 42 jobs" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Remote only" }));
    expect(within(sheet).getByRole("button", { name: "Show 1 job" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Clear" }));
    expect(within(sheet).getByRole("button", { name: "Show 42 jobs" })).toBeInTheDocument();
  });

  it("says so when nothing matches, with a way out", async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(await screen.findByLabelText("Search your jobs"), "zzzz");
    expect(await screen.findByText("No jobs match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => expect(rows()).toHaveLength(30));
  });
});
