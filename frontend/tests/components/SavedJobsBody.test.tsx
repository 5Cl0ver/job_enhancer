import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

import { SavedJobsBody } from "@/components/jobs/SavedJobsBody";

function saved(id: string, title: string, origin: string | null, scout: unknown = null) {
  return {
    id,
    job_listing_id: `listing-${id}`,
    pipeline_stage_id: null,
    applied_at: null,
    origin,
    scout,
    job_listing: {
      id: `listing-${id}`,
      title,
      company: "Vellacor",
      location: "Springfield, IL",
      is_remote: false,
      is_expired: false,
      source: "manual",
      salary_min: null,
      salary_max: null,
      salary_period: null,
      currency: null,
      job_type: null,
      posted_at: null,
      apply_url: "https://careers.vellacor.example/jobs/1",
    },
  };
}

const JOBS = [
  saved("1", "Systems Administrator", "scout", { fit_score: 8, run_id: "r1" }),
  saved("2", "Help Desk Lead", "email"),
  saved("3", "Jira Administrator", null),
];
const COLLECTIONS = [
  { id: "c1", name: "IT Admin", is_default: false, created_at: "2026-11-19T00:00:00Z" },
];

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SavedJobsBody />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jobCalls = () =>
  get.mock.calls.map(([p]) => p as string).filter((p) => p.startsWith("/v1/saved-jobs/?"));

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith("/v1/collections")) return Promise.resolve(COLLECTIONS);
    if (path.includes("collection_id=gone")) return Promise.resolve([]);
    if (path.startsWith("/v1/saved-jobs")) return Promise.resolve(JOBS);
    return Promise.resolve([]);
  });
});

describe("My Jobs list (computer)", () => {
  it("labels each job with where it came from", async () => {
    renderAt("/jobs");
    expect(await screen.findByText("Claude Scout · fit 8/10")).toBeInTheDocument();
    expect(screen.getByText("From an email", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText(/^manual$/i)).not.toBeInTheDocument();
  });

  it("narrows to one origin, offering only the origins present", async () => {
    renderAt("/jobs");
    const pick = await screen.findByRole("combobox", { name: "Where from" });
    expect([...pick.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "From anywhere",
      "Claude Scout",
      "From an email",
    ]);
    await userEvent.selectOptions(pick, "scout");
    expect(screen.getByText("Systems Administrator")).toBeInTheDocument();
    expect(screen.queryByText("Help Desk Lead")).not.toBeInTheDocument();
    expect(screen.queryByText("Jira Administrator")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.getByText("Jira Administrator")).toBeInTheDocument();
  });

  it("opens on the collection and origin in the link", async () => {
    renderAt("/jobs?folder=c1&origin=email");
    expect(await screen.findByText("Help Desk Lead")).toBeInTheDocument();
    expect(screen.queryByText("Systems Administrator")).not.toBeInTheDocument();
    expect(jobCalls()).toContainEqual(expect.stringContaining("collection_id=c1"));
  });

  it("shows every job when the linked collection no longer exists", async () => {
    renderAt("/jobs?folder=gone");
    expect(await screen.findByText("Jira Administrator")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Vellacor")).toHaveLength(3));
  });
});
