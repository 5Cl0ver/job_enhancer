import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ScoutResults } from "@/components/scout/ScoutResults";
import type { FindingItem, FindingPage } from "@/lib/scout";

function item(id: string, over: Partial<FindingItem>): FindingItem {
  return {
    id,
    run_id: "r1",
    run_name: "LinkedIn · IT Admin · 10 · last 7 days",
    track_id: "t1",
    source: "linkedin",
    search_title: null,
    title: `Job ${id}`,
    company: "Vellacor",
    location: "Springfield, IL",
    level: "mid",
    years_asked: 3,
    posted: "2 days ago",
    url: `https://www.linkedin.com/jobs/view/${id}`,
    fit: 7,
    claude_fit: 7,
    band: "best",
    min_fit: 6,
    why_fit: "Runs Microsoft 365 daily",
    gaps: "No Intune cert",
    app_note: null,
    status: "new",
    outcome: "picked",
    facts_from: "copy",
    can_save: true,
    saved_job_id: null,
    job_listing_id: null,
    found_at: "2026-11-20T10:00:00Z",
    ...over,
  };
}

const PAGE: FindingPage = {
  items: [
    item("a", { title: "Systems Administrator", fit: 8 }),
    item("b", {
      title: "IT Support Specialist",
      company: "Quillstone",
      fit: 7,
      can_save: false,
      outcome: "no_copy",
      facts_from: "claude",
    }),
    item("c", {
      title: "Senior Systems Engineer",
      fit: 5,
      claude_fit: 9,
      band: "possible",
      level: "senior",
      app_note: "Lowered to 5: senior role, you chose Entry–Mid",
    }),
    item("d", { title: "IT Director", fit: 2, band: "long_shot" }),
  ],
  counts: {
    best: 2,
    possible: 1,
    long_shot: 1,
    new: 4,
    saved: 1,
    passed: 0,
    hidden: 3,
  },
  next: null,
};

function show(at = "/?view=results") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <ScoutResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith("/v1/scout/findings")) return Promise.resolve(PAGE);
    if (path === "/v1/scout/tracks") return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

describe("Scout Results", () => {
  it("groups every job Best / Possible / Long shots, long shots folded", async () => {
    show();
    const best = await screen.findByRole("heading", { name: /Best 2/ });
    expect(best).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Possible 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Long shots 1/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Systems Administrator")).toBeInTheDocument();
    expect(screen.queryByText("IT Director")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Long shots/ }));
    expect(screen.getByText("IT Director")).toBeInTheDocument();
    // Opens on the last run, new jobs, best first.
    expect(get).toHaveBeenCalledWith(
      "/v1/scout/findings?status=new&sort=fit&limit=100&run=last",
    );
  });

  it("shows Claude's facts, the level cap, and how to save a job that wasn't copied", async () => {
    show();
    expect(
      await screen.findByText(
        "Vellacor · Mid · 3+ yrs · Springfield, IL · 2 days ago",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lowered to 5: senior role, you chose Entry–Mid"),
    ).toBeInTheDocument();
    expect(screen.getByText("As Claude read it")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: /Open and press Save/ });
    expect(open).toHaveAttribute(
      "href",
      "https://www.linkedin.com/jobs/view/b",
    );
    // Only the copied one can be saved from here.
    expect(
      screen.getAllByRole("button", { name: "Save to My Jobs" }),
    ).toHaveLength(2);
  });

  it("saves and passes on a job", async () => {
    post.mockResolvedValue({
      finding_id: "a",
      saved_job_id: "s1",
      already: false,
      folder: { id: "c1", name: "IT Admin" },
    });
    show();
    const row = (await screen.findByText("Systems Administrator")).closest(
      "li",
    )!;
    await userEvent.click(
      within(row).getByRole("button", { name: "Save to My Jobs" }),
    );
    expect(post).toHaveBeenCalledWith("/v1/scout/findings/a/save", {});
    await userEvent.click(within(row).getByRole("button", { name: "Pass" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/scout/findings/a/pass", {}),
    );
  });

  it("filters by status, with counts", async () => {
    show();
    const hidden = await screen.findByRole("button", { name: "Hidden 3" });
    await userEvent.click(hidden);
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        "/v1/scout/findings?status=hidden&sort=fit&limit=100&run=last",
      ),
    );
    expect(screen.getByRole("button", { name: "Hidden 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens on one run from See results, or all runs", async () => {
    show("/?view=results&run=all&status=new");
    await screen.findByText("Systems Administrator");
    expect(get).toHaveBeenCalledWith(
      "/v1/scout/findings?status=new&sort=fit&limit=100",
    );
    // Every run: each job says which search found it.
    expect(
      screen.getAllByText("Found by LinkedIn · IT Admin · 10 · last 7 days")
        .length,
    ).toBeGreaterThan(0);
  });

  it("says so when there's nothing new", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/v1/scout/findings")
          ? { items: [], counts: { ...PAGE.counts, new: 0 }, next: null }
          : [],
      ),
    );
    show();
    expect(
      await screen.findByText(/No new jobs from the last run/),
    ).toBeInTheDocument();
  });
});

describe("History after Results", () => {
  it("ignores Results' run=all instead of asking for a run called 'all'", async () => {
    const { ScoutHistory } = await import("@/components/scout/ScoutHistory");
    get.mockImplementation(() => Promise.resolve([]));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/?view=history&run=all"]}>
          <ScoutHistory />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(/No searches run yet/);
    expect(get).not.toHaveBeenCalledWith("/v1/scout/runs/all");
  });
});
