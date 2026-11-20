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

import { SavedJobsBody } from "@/components/jobs/SavedJobsBody";

function saved(id: string, title: string, origin: string | null, scout: unknown = null) {
  return {
    id,
    job_listing_id: `listing-${id}`,
    pipeline_stage_id: null,
    applied_at: null,
    emailed_at: null,
    flagged_for_research: false,
    notes: null,
    created_at: "2026-11-12T09:00:00Z",
    last_stage_change: "2026-11-12T09:00:00Z",
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
const EMAIL = {
  saved_job_id: "2",
  event_id: "e1",
  event_type: "interview",
  status: "applied",
  target_stage: "Interview",
  email_date: "2026-11-18T10:00:00Z",
  created_at: "2026-11-18T10:05:00Z",
  mail_link: "https://mail.yahoo.com/d/folders/1/messages/abc",
  mail_search_link: "https://mail.yahoo.com/d/search/keyword=x",
  count: 1,
};
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
    if (path.startsWith("/v1/email/job-emails/latest")) return Promise.resolve([EMAIL]);
    if (/\/v1\/email\/events\/[^/]+\/message/.test(path)) return new Promise(() => {});
    if (path.endsWith("/source"))
      return Promise.resolve({
        origin: "scout",
        saved_at: "2026-11-12T09:00:00Z",
        collection: { id: "c1", name: "IT Admin" },
        scout: null,
        email: null,
      });
    if (path.startsWith("/v1/jobs/")) return new Promise(() => {});
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

  it("opens the same pop-up as the board when a job is clicked", async () => {
    renderAt("/jobs");
    await userEvent.click(await screen.findByRole("button", { name: "Systems Administrator" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Actions")).toBeInTheDocument();
    for (const name of [/Write to the company/, /Research it with Claude/, /Add to Contact Further/]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("link", { name: /Open the full page/ })).toHaveAttribute(
      "href",
      "/jobs/listing-1",
    );
  });

  it("closes the pop-up when a link in it goes somewhere else in the app", async () => {
    renderAt("/jobs?folder=c1");
    await userEvent.click(await screen.findByRole("button", { name: "Systems Administrator" }));
    const dialog = await screen.findByRole("dialog");
    // The link points at the page already showing: the pop-up still closes.
    await userEvent.click(await within(dialog).findByRole("link", { name: /In IT Admin/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // And it doesn't come back by itself.
    await userEvent.click(screen.getByRole("button", { name: /All saved jobs/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the email behind a job from its card", async () => {
    renderAt("/jobs");
    const line = await screen.findByRole("button", { name: /Interview email · Nov 18/ });
    // Only the job with an email has the line.
    expect(screen.getAllByRole("button", { name: /email · / })).toHaveLength(1);
    await userEvent.click(line);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /Open in Yahoo Mail/ })).toHaveAttribute(
      "href",
      EMAIL.mail_link,
    );
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
