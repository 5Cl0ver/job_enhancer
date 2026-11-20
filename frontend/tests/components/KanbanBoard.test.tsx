import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const toastError = vi.fn();

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
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { KanbanBoard } from "@/components/tracker/KanbanBoard";

const STAGES = [
  { id: "applied", name: "Applied", color: null, sort_order: 0, is_default: true },
  { id: "interview", name: "Interview", color: null, sort_order: 1, is_default: true },
  { id: "offer", name: "Offer", color: null, sort_order: 2, is_default: true },
];

function saved(id: string, title: string, company: string, stage: string | null) {
  const now = new Date().toISOString();
  return {
    id,
    pipeline_stage_id: stage,
    flagged_for_research: false,
    applied_at: null,
    emailed_at: null,
    last_stage_change: now,
    created_at: now,
    updated_at: now,
    job_listing: { title, company, location: "Springfield, IL", is_remote: false },
  };
}

// 40 jobs in Applied (more than one page), one in Interview, one with no stage.
const JOBS = [
  ...Array.from({ length: 40 }, (_, i) =>
    saved(`a${i}`, i === 35 ? "Jira Administrator" : `Support Analyst ${i}`, i === 35 ? "Quillstone" : "Vellacor", "applied"),
  ),
  saved("i1", "IT Systems Administrator", "Brambleworks", "interview"),
  saved("n1", "Help Desk Technician", "Tessaline", null),
];

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KanbanBoard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const column = (name: string) =>
  screen.getByText(name, { selector: "span" }).closest("div.flex.min-h-0") as HTMLElement;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  toastError.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith("/v1/pipeline-stages")) return Promise.resolve(STAGES);
    if (path.startsWith("/v1/saved-jobs")) return Promise.resolve(JOBS);
    if (path.startsWith("/v1/users/me")) return Promise.resolve({ follow_up_days: 7 });
    return Promise.resolve([]);
  });
});

describe("KanbanBoard", () => {
  it("shows one page of a long column, and a job with no stage in the first column", async () => {
    renderBoard();
    const applied = await waitFor(() => column("Applied"));
    // 41 jobs belong here (40 + the one with no stage); 30 are drawn.
    expect(within(applied).getByText("41")).toBeInTheDocument();
    expect(within(applied).getAllByRole("button", { name: /Open details/ })).toHaveLength(30);
    expect(within(applied).getByRole("button", { name: /Show more \(11 left\)/ })).toBeInTheDocument();
  });

  it("collapses an empty stage to a strip", async () => {
    renderBoard();
    const strip = await screen.findByRole("button", { name: /Offer/ });
    expect(strip).toHaveAttribute("title", expect.stringContaining("no jobs"));
  });

  it("search brings a match from past the first page to the top and counts it", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.type(await screen.findByLabelText("Search the board"), "quillstone");

    const applied = column("Applied");
    await waitFor(() => expect(within(applied).getByText("1 of 41")).toBeInTheDocument());
    const first = within(applied).getAllByRole("button", { name: /Open details/ })[0];
    expect(first).toHaveAccessibleName(/Jira Administrator at Quillstone/);
    expect(within(first).getByText("Quillstone").tagName).toBe("MARK");
    expect(screen.getByText(/1 match/)).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.type(await screen.findByLabelText("Search the board"), "zzzz");
    expect(await screen.findByText("No jobs match")).toBeInTheDocument();
  });

  it("moves a card with the Move to menu", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    renderBoard();
    await user.click(await screen.findByRole("button", { name: "Move or flag IT Systems Administrator" }));
    await user.click(await screen.findByRole("menuitem", { name: "Applied" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/pipeline-stages/move", {
        saved_job_id: "i1",
        stage_id: "applied",
      }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("lets a job with no stage be put in the column it is shown in", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    renderBoard();
    await user.type(await screen.findByLabelText("Search the board"), "tessaline");
    await user.click(await screen.findByRole("button", { name: "Move or flag Help Desk Technician" }));
    const applied = await screen.findByRole("menuitem", { name: "Applied" });
    expect(applied).not.toHaveAttribute("data-disabled");
    await user.click(applied);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/pipeline-stages/move", {
        saved_job_id: "n1",
        stage_id: "applied",
      }),
    );
  });

  it("shows the email behind a job's stage on its card, and opens it from there", async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith("/v1/pipeline-stages")) return Promise.resolve(STAGES);
      if (path.startsWith("/v1/saved-jobs")) return Promise.resolve(JOBS);
      if (path.startsWith("/v1/users/me")) return Promise.resolve({ follow_up_days: 7 });
      if (path.startsWith("/v1/email/job-emails/latest"))
        return Promise.resolve([
          {
            saved_job_id: "i1",
            event_id: "ev1",
            event_type: "interview",
            status: "auto_applied",
            target_stage: "Interview",
            created_at: "2026-11-18T10:00:00Z",
            count: 1,
          },
        ]);
      if (path === "/v1/email/events/ev1/message")
        return Promise.resolve({
          subject: "Phone screen",
          from_addr: "talent@brambleworks.example",
          date: null,
          text: "Are you free Thursday?",
          mail_link: "https://mail.yahoo.com/d/folders/1/messages/abc",
          mail_search_link: null,
        });
      return Promise.resolve([]);
    });
    renderBoard();

    const line = await screen.findByRole("button", { name: /Interview email · Nov 18/ });
    // Only the job with an email gets the line.
    expect(screen.getAllByRole("button", { name: /email · /i })).toHaveLength(1);
    await user.click(line);

    const view = await screen.findByRole("dialog");
    expect(await within(view).findByText("Are you free Thursday?")).toBeInTheDocument();
    expect(within(view).getByRole("link", { name: /Open in Yahoo Mail/ })).toBeInTheDocument();
    // The email opened, not the job's own dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("tells the user when a move fails, with Retry", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error("network"));
    renderBoard();
    await user.click(await screen.findByRole("button", { name: "Move or flag IT Systems Administrator" }));
    await user.click(await screen.findByRole("menuitem", { name: "Applied" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const [message, options] = toastError.mock.calls[0];
    expect(message).toMatch(/Couldn't move/);
    expect(options.action.label).toBe("Retry");
    options.action.onClick();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });
});
