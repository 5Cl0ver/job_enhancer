import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

import { JobCard } from "@/components/jobs/JobCard";
import { WhereFrom } from "@/components/jobs/WhereFrom";
import type { SavedJob } from "@/types/api";

const LISTING = {
  id: "listing-1",
  title: "Systems Administrator",
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
  apply_url: "https://careers.vellacor.example/jobs/41",
  description_preview: "Run Microsoft 365 for 400 staff.",
};

function saved(over: Partial<SavedJob>): SavedJob {
  return {
    id: "s1",
    job_listing_id: "listing-1",
    created_at: "2026-11-12T09:00:00Z",
    applied_at: null,
    origin: null,
    scout: null,
    job_listing: LISTING,
    ...over,
  } as SavedJob;
}

let source: unknown = null;

function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path.endsWith("/source")) return Promise.resolve(source);
    if (path.startsWith("/v1/email/messages")) return new Promise(() => {});
    return Promise.resolve([]);
  });
});

describe("WhereFrom", () => {
  it("shows Claude's reasons and leads back to the search and the collection", async () => {
    source = {
      origin: "scout",
      saved_at: "2026-11-19T15:02:00Z",
      collection: { id: "c1", name: "IT Admin" },
      scout: {
        run_id: "run-1",
        finding_id: "f1",
        source: "linkedin",
        search_name: "LinkedIn · IT Admin · 5",
        fit_score: 8,
        why_fit: "Runs Microsoft 365 and Entra ID daily",
        gaps: "No Intune certificate",
        found_at: "2026-11-19T15:01:00Z",
      },
      email: null,
    };
    show(<WhereFrom savedJob={saved({ origin: "scout", scout: { fit_score: 8, run_id: "run-1" } })} />);

    expect(await screen.findByText("Runs Microsoft 365 and Entra ID daily")).toBeInTheDocument();
    expect(screen.getByText("No Intune certificate")).toBeInTheDocument();
    expect(screen.getByText("Claude Scout · fit 8/10")).toBeInTheDocument();
    expect(screen.getByText(/on LinkedIn/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the search that found it" })).toHaveAttribute(
      "href",
      "/search?tab=scout&view=history&run=run-1",
    );
    expect(screen.getByRole("link", { name: /In IT Admin/ })).toHaveAttribute(
      "href",
      "/jobs?folder=c1",
    );
  });

  it("offers the email a job was made from", async () => {
    source = {
      origin: "email",
      saved_at: "2026-11-19T15:02:00Z",
      collection: null,
      scout: null,
      email: {
        event_id: "e1",
        event_type: "interview",
        email_date: "2026-11-18T10:00:00Z",
        mail_link: "https://mail.yahoo.com/d/folders/1/messages/abc",
        mail_search_link: "https://mail.yahoo.com/d/search/keyword=x",
      },
    };
    show(<WhereFrom savedJob={saved({ origin: "email" })} />);

    expect(screen.getByText("From an email")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "View the email" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.stringContaining("e1"));
    expect(screen.queryByRole("link", { name: /See the search/ })).not.toBeInTheDocument();
  });

  it("is absent for a job it knows nothing about", async () => {
    source = { origin: null, saved_at: "2026-11-12T09:00:00Z", collection: null, scout: null, email: null };
    const { container } = show(<WhereFrom savedJob={saved({})} />);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a saved job's card", () => {
  it("says where the job came from, never the feed name", () => {
    show(<JobCard job={LISTING as never} isSaved savedJob={saved({ origin: "extension" })} />);
    expect(screen.getByText("Job Catcher")).toBeInTheDocument();
    expect(screen.queryByText(/manual/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/ })).toBeInTheDocument();
  });

  it("shows no label when the origin isn't known", () => {
    show(<JobCard job={LISTING as never} isSaved savedJob={saved({})} />);
    expect(screen.queryByText(/manual/i)).not.toBeInTheDocument();
  });

  it("opens the email, not a posting, for a job made from an email", () => {
    show(<JobCard job={LISTING as never} isSaved savedJob={saved({ origin: "email" })} />);
    expect(screen.getByRole("link", { name: /Open the email/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply Now/ })).not.toBeInTheDocument();
  });

  it("keeps the feed name on a search result that isn't saved", () => {
    show(<JobCard job={{ ...LISTING, source: "adzuna" } as never} />);
    expect(screen.getByText("adzuna")).toBeInTheDocument();
  });
});
