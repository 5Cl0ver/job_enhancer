import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import { ScoutStart } from "@/components/scout/ScoutStart";
import type { Finding, Run } from "@/lib/scout";

function finding(id: string, title: string, company: string, over: Partial<Finding>): Finding {
  return {
    id,
    outcome: "picked",
    source: "linkedin",
    url: `https://www.linkedin.com/jobs/view/${id}`,
    company,
    title,
    fit_score: 8,
    why_fit: `Why ${title}`,
    gaps: "",
    app_note: null,
    saved_job_id: null,
    job_listing_id: null,
    collection_id: null,
    collection_name: null,
    can_save: true,
    created_at: "2026-11-19T15:00:00Z",
    ...over,
  };
}

const FINDINGS = [
  finding("f1", "Systems Administrator", "Vellacor", {}),
  finding("f2", "IT Administrator", "Quillstone", { fit_score: 7 }),
  finding("f3", "Help Desk Lead", "Brambleworks", {
    outcome: "below_bar",
    fit_score: 4,
    app_note: "Fit under your minimum of 6",
  }),
  finding("f4", "Network Engineer", "Tessaline", {
    outcome: "duplicate",
    can_save: false,
    job_listing_id: "l4",
  }),
  finding("f5", "", "", { outcome: "no_copy", can_save: false }),
];

const RUN: Run = {
  id: "r1",
  mission_id: "m1",
  name: "LinkedIn · IT Admin · 5 · last 7 days",
  source: "linkedin",
  track_name: "IT Admin",
  target: 5,
  status: "done",
  note: "Only two new ones this week",
  created_at: "2026-11-19T15:00:00Z",
  started_at: "2026-11-19T15:00:10Z",
  finished_at: "2026-11-19T15:06:00Z",
  counts: { picked: 2, saved: 0, skipped: 0, below_bar: 1, duplicate: 1, waiting_for_copy: 0, no_copy: 1 },
  needs_review: true,
  folder: { id: null, name: "IT Admin" },
  looked_at: { rows: 24, in_tracker: 2, seen_before: 9, excluded: 4 },
  findings: FINDINGS,
};
const TRACK = {
  id: "t1",
  name: "IT Admin",
  target_titles: ["Systems Administrator"],
  key_skills: [],
  skip_rules: { degree_only: true, max_years: null, exclude: [] },
  min_pay: null,
  resume_id: null,
  resume_filename: null,
  notes: null,
  sort_order: 0,
  job_count: 0,
  created_at: "2026-11-18T00:00:00Z",
  updated_at: "2026-11-18T00:00:00Z",
};
const COLLECTIONS = [
  { id: "c9", name: "Shortlist", is_default: false, created_at: "2026-11-01T00:00:00Z" },
];

let run: Run = RUN;

function renderStart() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScoutStart onSetUpTypes={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const box = (name: RegExp) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  run = RUN;
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path === "/v1/scout/tracks") return Promise.resolve([TRACK]);
    if (path === "/v1/scout/runs") return Promise.resolve([{ ...run, findings: [] }]);
    if (path === "/v1/scout/runs/r1") return Promise.resolve(run);
    if (path.startsWith("/v1/collections")) return Promise.resolve(COLLECTIONS);
    return Promise.resolve([]);
  });
});

describe("the review after a Scout search", () => {
  it("ticks Claude's good fits, leaves the rest, and saves nothing by itself", async () => {
    renderStart();
    const review = await screen.findByRole("region", { name: "Pick what to keep" });
    expect(within(review).getByText(/Claude found 2 good fits/)).toBeInTheDocument();
    expect(box(/Keep Systems Administrator at Vellacor/)).toBeChecked();
    expect(box(/Keep IT Administrator at Quillstone/)).toBeChecked();
    expect(box(/Keep Help Desk Lead at Brambleworks/)).not.toBeChecked();
    expect(within(review).getByText("Fit under your minimum of 6")).toBeInTheDocument();
    // Jobs that can't be saved have no box, and say why.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(within(review).getByText(/Already in My Jobs/)).toBeInTheDocument();
    expect(within(review).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/jobs/l4");
    expect(within(review).getByText("Couldn't copy the page")).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Save 2 to My Jobs" })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("says why the search came back short, in numbers that add up", async () => {
    renderStart();
    expect(
      await screen.findByText(
        "Asked for 5, found 2. Looked at 24 postings: 9 seen in earlier searches · 4 skipped by title · " +
          "2 already in My Jobs · 1 below your bar · 1 you already had · 1 couldn't be copied · 4 not opened.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Only two new ones this week")).toBeInTheDocument();
  });

  it("saves exactly what is ticked with one press and says where it went", async () => {
    post.mockImplementation(() => {
      run = {
        ...RUN,
        needs_review: false,
        counts: { ...RUN.counts, picked: 0, saved: 2, skipped: 1 },
      };
      return Promise.resolve({
        saved: [
          { finding_id: "f1", saved_job_id: "s1" },
          { finding_id: "f3", saved_job_id: "s3" },
        ],
        already: [],
        failed: [],
        folder: { id: "c1", name: "IT Admin" },
      });
    });
    const user = userEvent.setup();
    renderStart();
    await screen.findByRole("region", { name: "Pick what to keep" });
    await user.click(box(/Keep IT Administrator/));
    await user.click(box(/Keep Help Desk Lead/));
    await user.click(screen.getByRole("button", { name: "Save 2 to My Jobs" }));

    expect(post).toHaveBeenCalledWith("/v1/scout/runs/r1/confirm", {
      finding_ids: ["f1", "f3"],
      shown_ids: ["f1", "f2", "f3", "f4", "f5"],
    });
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("2 saved to My Jobs › IT Admin");
    expect(within(note).getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/jobs?folder=c1",
    );
    // The review is done with; the note stays.
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Pick what to keep" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("says a job is still being copied, not that copying failed", async () => {
    run = {
      ...RUN,
      status: "running",
      findings: [...FINDINGS, finding("f6", "", "", { outcome: "waiting_for_copy", can_save: false })],
    };
    renderStart();
    const review = await screen.findByRole("region", { name: "Pick what to keep" });
    expect(within(review).getByText("Copying the page…")).toBeInTheDocument();
    expect(within(review).getAllByText("Couldn't copy the page")).toHaveLength(1);
  });

  it("offers 'Keep none' when nothing is ticked", async () => {
    post.mockResolvedValue({ saved: [], already: [], failed: [], folder: { id: null, name: "IT Admin" } });
    const user = userEvent.setup();
    renderStart();
    await screen.findByRole("region", { name: "Pick what to keep" });
    await user.click(box(/Keep Systems Administrator/));
    await user.click(box(/Keep IT Administrator/));
    await user.click(screen.getByRole("button", { name: "Keep none" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/runs/r1/confirm",
      expect.objectContaining({ finding_ids: [] }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing new was saved.");
  });

  it("a new collection needs a name before anything is saved into it", async () => {
    post.mockResolvedValue({
      saved: [{ finding_id: "f1", saved_job_id: "s1" }],
      already: [],
      failed: [],
      folder: { id: "c2", name: "This week" },
    });
    const user = userEvent.setup();
    renderStart();
    await screen.findByRole("region", { name: "Pick what to keep" });
    await user.click(box(/Keep IT Administrator/));
    await user.click(screen.getByRole("combobox", { name: "Save into" }));
    await user.click(await screen.findByRole("option", { name: "New collection…" }));
    const save = screen.getByRole("button", { name: "Save 1 to My Jobs" });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "New collection name" }), "This week");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/runs/r1/confirm",
      expect.objectContaining({ finding_ids: ["f1"], new_collection_name: "This week" }),
    );
  });

  it("keeps the review up when saving fails, with the reason", async () => {
    post.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderStart();
    await screen.findByRole("region", { name: "Pick what to keep" });
    await user.click(screen.getByRole("button", { name: "Save 2 to My Jobs" }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(box(/Keep Systems Administrator/)).toBeChecked();
  });
});
