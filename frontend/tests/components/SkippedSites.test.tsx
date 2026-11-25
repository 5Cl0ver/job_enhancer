import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    api: {
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...args: unknown[]) => del(...args),
    },
    ApiError,
    getAccessToken: vi.fn().mockResolvedValue("token"),
    API_BASE: "http://localhost:8000",
  };
});

import { ApiError } from "@/lib/api";
import { JobActions } from "@/components/jobs/JobActions";
import { SkippedSites } from "@/components/scout/SkippedSites";
import type { JobListing, SavedJob } from "@/types/api";

const PASTED = "https://www.learn4good.com/jobs/online_remote/engineering/5663701391/e/";
const WHY = "Claude Scout searches LinkedIn: skipping linkedin.com means your LinkedIn searches bring back nothing.";

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function serve(sites: { id: string; host: string }[], suggestions: { host: string; finds: number }[] = []) {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/v1/skipped-sites"
        ? sites.map((s) => ({ ...s, created_at: "2026-11-25T10:00:00Z" }))
        : path === "/v1/skipped-sites/suggestions"
          ? suggestions
          : null,
    ),
  );
}

describe("Sites to skip", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
  });

  it("adds a pasted link, and says when it's already there", async () => {
    serve([]);
    post.mockResolvedValueOnce({ id: "s1", host: "learn4good.com", already: false });
    const user = userEvent.setup();
    renderWith(<SkippedSites />);
    expect(await screen.findByText("None yet.")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Paste a link or a site"), PASTED);
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/skipped-sites", { site: PASTED, confirm: false }),
    );
    expect(screen.getByPlaceholderText("Paste a link or a site")).toHaveValue("");

    post.mockResolvedValueOnce({ id: "s1", host: "learn4good.com", already: true });
    await user.type(screen.getByPlaceholderText("Paste a link or a site"), "learn4good.com{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "learn4good.com is already on your list.",
    );
  });

  it("shows the server's message for text that isn't a site", async () => {
    serve([]);
    post.mockRejectedValueOnce(
      new ApiError(400, "That isn't a site. Paste a link, or a site like learn4good.com."),
    );
    const user = userEvent.setup();
    renderWith(<SkippedSites />);
    await user.type(screen.getByPlaceholderText("Paste a link or a site"), "hello{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("That isn't a site.");
  });

  it("warns before skipping a site Scout searches, and adds it only when told", async () => {
    serve([]);
    post.mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ detail: { needs_confirm: true, why: WHY } })),
    );
    const user = userEvent.setup();
    renderWith(<SkippedSites />);
    await user.type(screen.getByPlaceholderText("Paste a link or a site"), "linkedin.com{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(WHY);
    await user.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);

    post.mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ detail: { needs_confirm: true, why: WHY } })),
    );
    post.mockResolvedValueOnce({ id: "s2", host: "linkedin.com", already: false });
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("button", { name: "Skip it anyway" }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith("/v1/skipped-sites", {
        site: "linkedin.com",
        confirm: true,
      }),
    );
  });

  it("removes a site with one tap", async () => {
    serve([{ id: "s1", host: "learn4good.com" }]);
    del.mockResolvedValue(null);
    const user = userEvent.setup();
    renderWith(<SkippedSites />);
    const list = await screen.findByRole("list", { name: "Sites to skip" });
    expect(within(list).getByText("learn4good.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove learn4good.com" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/v1/skipped-sites/s1"));
  });

  it("suggests sites from the user's finds, added only with a tap", async () => {
    serve([], [{ host: "jobleads.com", finds: 7 }]);
    post.mockResolvedValue({ id: "s3", host: "jobleads.com", already: false });
    const user = userEvent.setup();
    renderWith(<SkippedSites />);
    const list = await screen.findByRole("list", { name: "Suggested sites" });
    expect(list).toHaveTextContent("jobleads.com · 7 finds");
    expect(post).not.toHaveBeenCalled();
    await user.click(within(list).getByRole("button", { name: "Skip it: jobleads.com" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/skipped-sites", {
        site: "jobleads.com",
        confirm: false,
      }),
    );
  });
});

describe("Never this site", () => {
  const savedJob = {
    id: "sj1",
    job_listing_id: "jl1",
    origin: "scout",
    emailed_at: null,
    flagged_for_research: false,
  } as unknown as SavedJob;
  const listing = {
    id: "jl1",
    title: "IT Systems Administrator",
    company: "Brambleworks",
    apply_url: PASTED,
  } as unknown as JobListing;

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("adds the job's site, then says it's skipped", async () => {
    serve([]);
    post.mockResolvedValue({ id: "s1", host: "learn4good.com", already: false });
    const user = userEvent.setup();
    renderWith(<JobActions page savedJob={savedJob} listing={listing} />);
    await user.click(await screen.findByRole("button", { name: /Never this site/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/skipped-sites", { site: PASTED, confirm: false }),
    );
  });

  it("says so when the site is skipped already", async () => {
    serve([{ id: "s1", host: "learn4good.com" }]);
    renderWith(<JobActions page savedJob={savedJob} listing={listing} />);
    expect(await screen.findByText(/learn4good\.com is on your/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Never this site/ })).not.toBeInTheDocument();
  });

  it.each([
    "https://boards.greenhouse.io/acme/jobs/1",
    "https://jobs.lever.co/acme/123",
    "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/1",
  ])("isn't offered on an application system many companies use (%s)", async (url) => {
    serve([]);
    renderWith(<JobActions page savedJob={savedJob} listing={{ ...listing, apply_url: url }} />);
    await screen.findByRole("button", { name: /Research it with Claude/ });
    expect(screen.queryByRole("button", { name: /Never this site/ })).not.toBeInTheDocument();
  });

  it("shows the server's own message when it can't be added", async () => {
    serve([]);
    post.mockRejectedValue(
      new ApiError(400, "That's shared by many sites, so it can't be skipped. Paste the site itself."),
    );
    const user = userEvent.setup();
    renderWith(<JobActions page savedJob={savedJob} listing={listing} />);
    await user.click(await screen.findByRole("button", { name: /Never this site/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That's shared by many sites");
    expect(screen.queryByRole("button", { name: "Skip it anyway" })).not.toBeInTheDocument();
  });

  it("isn't offered for a job made from an email", async () => {
    serve([]);
    renderWith(
      <JobActions page savedJob={{ ...savedJob, origin: "email" }} listing={listing} />,
    );
    await screen.findByRole("button", { name: /Research it with Claude/ });
    expect(screen.queryByRole("button", { name: /Never this site/ })).not.toBeInTheDocument();
  });
});
