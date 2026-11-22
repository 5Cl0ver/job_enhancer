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
      status: "applied",
      saved_job_id: "real",
      company: "Department of Harbor Services",
      title: "Workflow Platform Engineer",
      path,
    }),
  );
  return show(<EmailUpdatesPage />);
}

describe("an update about a job the app couldn't place", () => {
  it("can be put on one of my jobs", async () => {
    const user = userEvent.setup();
    emailPage([UNSAVED]);
    await user.click(await screen.findByRole("button", { name: /One of my jobs/ }));
    const dialog = await screen.findByRole("dialog");
    expect(get).toHaveBeenCalledWith("/v1/email/events/ev1/link-options");
    await user.click(
      await within(dialog).findByRole("button", { name: /Workflow Platform Engineer/ }),
    );
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/link", { saved_job_id: "real" });
    expect(
      await screen.findByText(/Department of Harbor Services: moved to Interview/),
    ).toBeInTheDocument();
  });

  it("offers the likely job in one tap, and asks before adding a new one", async () => {
    const user = userEvent.setup();
    emailPage([
      {
        ...UNSAVED,
        company: "Harbor Services",
        title: "Platform Engineer",
        likely_job: {
          saved_job_id: "real",
          job_listing_id: "l-real",
          title: "Workflow Platform Engineer",
          company: "Department of Harbor Services",
        },
      } as DetectedEvent,
    ]);
    expect(await screen.findByText(/Looks like your/)).toHaveTextContent(
      "Looks like your Workflow Platform Engineer job at Department of Harbor Services.",
    );
    // Adding a new job first asks about the saved one.
    await user.click(screen.getByRole("button", { name: "Add to My Jobs" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Is it one of your saved jobs?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "No, add it as a new job" }));
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/track", {
      company: "Harbor Services",
      title: "Platform Engineer",
    });
  });

  it("links the likely job straight from the row", async () => {
    const user = userEvent.setup();
    emailPage([
      {
        ...UNSAVED,
        likely_job: {
          saved_job_id: "real",
          job_listing_id: "l-real",
          title: "Workflow Platform Engineer",
          company: "Department of Harbor Services",
        },
      } as DetectedEvent,
    ]);
    await user.click(await screen.findByRole("button", { name: "Yes, link it" }));
    expect(post).toHaveBeenCalledWith("/v1/email/events/ev1/link", { saved_job_id: "real" });
  });
});
