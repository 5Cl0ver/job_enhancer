import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
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

import { SameJobButton } from "@/components/jobs/SameJob";
import EmailUpdatesPage from "@/routes/EmailUpdatesPage";
import type { DetectedEvent } from "@/hooks/useEmailAccount";

// Invented jobs only.
const OPTIONS = [
  {
    saved_job_id: "real",
    title: "Workflow Platform Engineer",
    company: "Department of Harbor Services",
    location: "Portsmouth, ME",
    stage: "Applied",
    likely: true,
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    saved_job_id: `other${i}`,
    title: `Data Analyst ${i}`,
    company: "Vellacor",
    location: null,
    stage: "Saved",
    likely: false,
  })),
];

const UNDO = {
  target_id: "real",
  events: [{ id: "e1", previous_stage_id: null }],
  previous_stage_id: "st-applied",
  stage_moved: true,
  previous_applied_at: null,
};

function show(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {ui}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("Same job as…", () => {
  it("shows only on a job made from an email", () => {
    show(<SameJobButton savedJob={{ id: "s1", origin: "scout" }} />);
    expect(screen.queryByRole("button", { name: /Same job as/ })).toBeNull();
  });

  it("lists likely jobs first, searches, links, and undoes", async () => {
    get.mockResolvedValue(OPTIONS);
    post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/link")
          ? { saved_job_id: "real", job_listing_id: "l-real", stage: "Interview", undo: UNDO }
          : null,
      ),
    );
    const onLinked = vi.fn();
    const user = userEvent.setup();
    show(<SameJobButton savedJob={{ id: "copy", origin: "email" }} onLinked={onLinked} />);

    await user.click(screen.getByRole("button", { name: /Same job as/ }));
    const dialog = await screen.findByRole("dialog");
    expect(get).toHaveBeenCalledWith("/v1/saved-jobs/copy/link-options");
    const list = await within(dialog).findByRole("list", { name: "Your jobs" });
    const rows = within(list).getAllByRole("button");
    // The likely one first, flagged; six shown until "Show all".
    expect(rows[0]).toHaveTextContent("Workflow Platform Engineer");
    expect(rows[0]).toHaveTextContent("Likely");
    expect(rows).toHaveLength(6);
    expect(within(dialog).getByRole("button", { name: "Show all 9" })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Search your jobs"), "analyst 7");
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    await user.clear(within(dialog).getByLabelText("Search your jobs"));
    await user.type(within(dialog).getByLabelText("Search your jobs"), "harbor");

    await user.click(within(list).getByRole("button", { name: /Workflow Platform Engineer/ }));
    expect(post).toHaveBeenCalledWith("/v1/saved-jobs/copy/link", { target_id: "real" });
    expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ job_listing_id: "l-real" }));
    expect(
      await screen.findByText("Linked to Workflow Platform Engineer, now in Interview."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(post).toHaveBeenLastCalledWith("/v1/saved-jobs/copy/unlink", UNDO);
  });
});

const UNSAVED: DetectedEvent = {
  id: "ev1",
  saved_job_id: null,
  job_listing_id: null,
  event_type: "interview",
  target_stage: "Interview",
  from_addr: "Rowan Pike <rowan.pike@dhs.example.gov>",
  subject: "Next phase of our recruitment process",
  status: "unsaved",
  category: "unsaved",
  company: null,
  title: null,
  email_date: "2026-11-21T10:00:00Z",
  created_at: "2026-11-21T10:00:00Z",
} as unknown as DetectedEvent;

function emailPage(events: DetectedEvent[]) {
  get.mockImplementation((path: string) => {
    if (path === "/v1/email/events") return Promise.resolve(events);
    if (path === "/v1/email/account")
      return Promise.resolve({
        id: "acc",
        email_address: "me@yahoo.com",
        provider: "yahoo",
        status: "connected",
        auto_move: true,
      });
    if (path.endsWith("/link-options")) return Promise.resolve(OPTIONS);
    return Promise.resolve([]);
  });
  post.mockImplementation((path: string) =>
    Promise.resolve({
      ...UNSAVED,
      saved_job_id: "real",
      company: "Department of Harbor Services",
      title: "Workflow Platform Engineer",
      current_stage: path.endsWith("/unlink") ? null : "Interview",
      status: path.endsWith("/unlink") ? "unsaved" : "applied",
      path,
    }),
  );
  return show(<EmailUpdatesPage />);
}

describe("an update about a job the app couldn't place", () => {
  it("has one main choice: pick the job", async () => {
    const user = userEvent.setup();
    emailPage([UNSAVED]);
    expect(await screen.findByText("Not sure which job")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Pick the job/ }));
    const dialog = await screen.findByRole("dialog");
    expect(get).toHaveBeenCalledWith("/v1/email/events/ev1/link-options");
    await user.click(
      await within(dialog).findByRole("button", { name: /Workflow Platform Engineer/ }),
    );
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/link", { saved_job_id: "real" });
    const row = (
      await screen.findByText("Put on Workflow Platform Engineer, now in Interview.")
    ).closest("li")!;

    // Undo lists the update again, to link elsewhere or add as a new job.
    await user.click(within(row).getByRole("button", { name: "Undo" }));
    expect(post).toHaveBeenLastCalledWith("/v1/email/events/ev1/unlink", {});
    expect(await screen.findByRole("button", { name: /Pick the job/ })).toBeInTheDocument();
  });

  it("can be added as a new job instead", async () => {
    const user = userEvent.setup();
    emailPage([{ ...UNSAVED, company: "Harbor Services", title: "Platform Engineer" }]);
    await user.click(await screen.findByRole("button", { name: "Add as new job" }));
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/track", {
      company: "Harbor Services",
      title: "Platform Engineer",
    });
  });

  it("asks for the names when the email didn't say them", async () => {
    const user = userEvent.setup();
    emailPage([UNSAVED]);
    await user.click(await screen.findByRole("button", { name: /Pick the job/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /not saved: add it as a new job/ }),
    );
    expect(await screen.findByLabelText("Company")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to My Jobs" })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("an update the app placed by its company", () => {
  const PLACED = {
    ...UNSAVED,
    saved_job_id: "real",
    job_listing_id: "l-real",
    match_evidence: "likely_job",
    company: "Department of Harbor Services",
    title: "Workflow Platform Engineer",
    current_stage: "Applied",
  };

  it("waiting: Move to Interview, or Wrong job", async () => {
    const user = userEvent.setup();
    emailPage([{ ...PLACED, status: "pending", category: "important" } as DetectedEvent]);
    expect(
      await screen.findByRole("button", { name: "Move to Interview" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wrong job" }));
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/unlink", {});
  });

  it("moved by itself: Wrong job puts it back and asks again", async () => {
    const user = userEvent.setup();
    emailPage([
      {
        ...PLACED,
        status: "auto_applied",
        category: "moved",
        current_stage: "Interview",
      } as DetectedEvent,
    ]);
    await user.click(await screen.findByRole("button", { name: /Department of Harbor/ }));
    await user.click(screen.getByRole("button", { name: "Wrong job" }));
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/unlink", {});
    expect(await screen.findByText(/Pick the right job/)).toBeInTheDocument();
  });
});
