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
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
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

import { ScoutStart } from "@/components/scout/ScoutStart";
import { SCOUT_LINE } from "@/lib/scout";

const TRACK = {
  id: "t1",
  name: "IT Admin",
  target_titles: ["IT Systems Administrator"],
  key_skills: [],
  skip_rules: { degree_only: true, max_years: null, exclude: [] },
  min_pay: 70000,
  resume_id: null,
  resume_filename: null,
  notes: null,
  sort_order: 0,
  job_count: 0,
  created_at: "2026-11-18T00:00:00Z",
  updated_at: "2026-11-18T00:00:00Z",
};

const MISSION = {
  id: "m1",
  name: "LinkedIn · IT Admin · 5 · last 7 days",
  source: "linkedin",
  track_id: "t1",
  job_count: 5,
  posted_within_days: 7,
  min_pay: null,
  location: "Springfield, IL",
  remote: "any",
  min_fit: 6,
  extra_instructions: null,
  collection_id: null,
  auto_save: false,
  collection_name: "IT Admin",
  last_run_at: null,
  created_at: "2026-11-18T00:00:00Z",
};

const RUN = {
  id: "r1",
  mission_id: "m1",
  name: MISSION.name,
  source: "linkedin",
  track_name: "IT Admin",
  target: 5,
  status: "queued",
  note: null,
  created_at: "2026-11-18T00:00:00Z",
  started_at: null,
  finished_at: null,
  counts: {
    saved: 0,
    below_bar: 0,
    duplicate: 0,
    waiting_for_copy: 0,
    no_copy: 0,
  },
  findings: [],
};

function renderStart() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScoutStart onSetUpTypes={() => {}} onOpenResults={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function serve(routes: Record<string, unknown>) {
  get.mockImplementation((path: string) => Promise.resolve(routes[path] ?? []));
}

describe("Claude Scout start", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("shows a saved search with its settings", async () => {
    serve({ "/v1/scout/tracks": [TRACK], "/v1/scout/missions": [MISSION] });
    renderStart();
    expect(await screen.findByText(MISSION.name)).toBeInTheDocument();
    // Pay falls back to the resume type's minimum.
    expect(
      screen.getByText(
        "Entry–mid IT Admin jobs · Springfield, IL + 25 mi · past week · fit 6+",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("up to 5 jobs a run · $70K+")).toBeInTheDocument();
    // And where its jobs will go.
    expect(screen.getByText("Saves into IT Admin")).toBeInTheDocument();
  });

  it("Start queues a run and shows the one line to tell Claude", async () => {
    let runs: unknown[] = [];
    get.mockImplementation((path: string) => {
      if (path === "/v1/scout/tracks") return Promise.resolve([TRACK]);
      if (path === "/v1/scout/missions") return Promise.resolve([MISSION]);
      if (path === "/v1/scout/runs") return Promise.resolve(runs);
      if (path === "/v1/scout/runs/r1") return Promise.resolve(RUN);
      return Promise.resolve([]);
    });
    post.mockImplementation(() => {
      runs = [RUN];
      return Promise.resolve(RUN);
    });
    const user = userEvent.setup();
    renderStart();

    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(post).toHaveBeenCalledWith("/v1/scout/missions/m1/runs", {});
    expect(await screen.findByText(SCOUT_LINE)).toBeInTheDocument();
    expect(screen.getByText("Waiting for Claude to start")).toBeInTheDocument();
    // Only one search at a time.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled(),
    );
  });

  it("lists what a running search found, with Claude's reasons labelled", async () => {
    const running = {
      ...RUN,
      status: "running",
      counts: { ...RUN.counts, saved: 1, below_bar: 1 },
      findings: [
        {
          id: "f1",
          outcome: "saved",
          source: "linkedin",
          url: "https://www.linkedin.com/jobs/view/1",
          company: "Brambleworks",
          title: "IT Systems Administrator",
          fit_score: 8,
          why_fit: "Runs Microsoft 365 daily",
          gaps: "No Intune cert",
          app_note: null,
          saved_job_id: "s1",
          job_listing_id: "l1",
          created_at: "2026-11-18T00:00:00Z",
        },
        {
          id: "f2",
          outcome: "no_copy",
          source: "linkedin",
          url: "https://www.linkedin.com/jobs/view/2",
          company: "",
          title: "",
          fit_score: 7,
          why_fit: "",
          gaps: "",
          app_note: "No page copy: open this job and press Save",
          saved_job_id: null,
          job_listing_id: null,
          created_at: "2026-11-18T00:00:00Z",
        },
      ],
    };
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/scout/runs": [running],
      "/v1/scout/runs/r1": running,
    });
    renderStart();

    expect(
      await screen.findByText("Searching · 1 of 5 found · 1 passed over"),
    ).toBeInTheDocument();
    const saved = screen.getByRole("link", {
      name: "IT Systems Administrator",
    });
    expect(saved).toHaveAttribute("href", "/jobs/l1");
    expect(screen.getByText("Runs Microsoft 365 daily")).toBeInTheDocument();
    expect(screen.getAllByText(/Claude: why it fits/)).toHaveLength(1);
    const manual = screen.getByRole("link", { name: /open and press save/i });
    expect(manual).toHaveAttribute(
      "href",
      "https://www.linkedin.com/jobs/view/2",
    );
    // Claude has started, so the line to say is no longer shown.
    expect(screen.queryByText(SCOUT_LINE)).toBeNull();
  });

  it("a new search chooses its collection and whether to ask first", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/collections/": [
        {
          id: "c9",
          name: "Shortlist",
          is_default: false,
          created_at: "2026-11-01T00:00:00Z",
        },
      ],
    });
    post.mockResolvedValue(MISSION);
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole("button", { name: /New search/ }));
    const form = await screen.findByRole("dialog");
    // Pre-filled: its own collection, named after the resume type, and it asks.
    const into = within(form).getByRole("combobox", { name: "Save into" });
    expect(into).toHaveTextContent("A collection named “IT Admin”");
    const ask = within(form).getByRole("switch", {
      name: "Save good fits without asking",
    });
    expect(ask).not.toBeChecked();

    await user.click(into);
    await user.click(await screen.findByRole("option", { name: "Shortlist" }));
    await user.click(ask);
    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/missions",
      expect.objectContaining({
        collection_id: "c9",
        auto_save: true,
        track_id: "t1",
      }),
    );
  });

  it("a Local companies search needs a city, and drops 'remote only'", async () => {
    serve({ "/v1/scout/tracks": [TRACK], "/v1/scout/missions": [MISSION] });
    post.mockResolvedValue({ ...MISSION, source: "local_companies" });
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole("button", { name: /New search/ }));
    const form = await screen.findByRole("dialog");
    await user.click(
      within(form).getByRole("combobox", { name: "Where to look" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Local companies" }),
    );
    expect(within(form).getByText(/No job boards/)).toBeInTheDocument();

    await user.click(within(form).getByRole("combobox", { name: "Remote" }));
    expect(
      screen.queryByRole("option", { name: "Remote only" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(within(form).getByText(/Add a city or area/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    await user.type(
      within(form).getByLabelText(/City or area/),
      "Springfield, IL",
    );
    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/missions",
      expect.objectContaining({
        source: "local_companies",
        location: "Springfield, IL",
      }),
    );
  });

  it("a running Local companies search says how many companies it checked", async () => {
    const run = {
      ...RUN,
      source: "local_companies",
      status: "running",
      looked_at: {
        companies: 4,
        companies_new: 3,
        companies_rechecked: 1,
        companies_with_openings: 2,
      },
    };
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/scout/runs": [run],
      "/v1/scout/runs/r1": run,
    });
    renderStart();
    expect(
      await screen.findByText(
        "Checked 4 local companies: 3 new · 1 re-checked · 2 had jobs listed.",
      ),
    ).toBeInTheDocument();
  });

  it("an Anything I'd be good at search lets Claude pick the titles, with overrides", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/ai/resumes": [{ id: "cv", is_active: true }],
    });
    post.mockResolvedValue({ ...MISSION, broad: true });
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole("button", { name: /New search/ }));
    const form = await screen.findByRole("dialog");
    await user.click(
      within(form).getByRole("combobox", { name: "Resume type" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Anything I'd be good at" }),
    );
    expect(
      within(form).getByText(/Claude reads your resume and picks/),
    ).toBeInTheDocument();
    expect(
      within(form).getByRole("combobox", { name: "Save into" }),
    ).toHaveTextContent("A collection named “Claude's picks”");
    // Step in: one title never searched, one word to skip (Enter adds it).
    await user.type(
      within(form).getByLabelText("Never search"),
      "Help Desk Technician",
    );
    await user.click(
      within(form).getByRole("button", { name: "Add to Never search" }),
    );
    await user.type(
      within(form).getByLabelText("Skip jobs with these words"),
      "sales, call center{Enter}",
    );
    expect(within(form).getByText("call center")).toBeInTheDocument();
    await user.click(
      within(form).getByRole("button", { name: "Remove call center" }),
    );
    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/missions",
      expect.objectContaining({
        broad: true,
        overrides: {
          always: [],
          never: ["Help Desk Technician"],
          avoid: ["sales"],
        },
      }),
    );
    expect(post.mock.calls[0][1]).not.toHaveProperty("track_id");
  });

  it("says to upload a resume when there isn't one", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/ai/resumes": [],
    });
    const user = userEvent.setup();
    renderStart();
    const link = await screen.findByRole("link", {
      name: "Upload your resume",
    });
    expect(link).toHaveAttribute("href", "/ai-apply");
    await user.click(screen.getByRole("button", { name: /New search/ }));
    const form = await screen.findByRole("dialog");
    await user.click(
      within(form).getByRole("combobox", { name: "Resume type" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Anything I'd be good at" }),
    );
    expect(
      within(form).getByText(/this search can't start/),
    ).toBeInTheDocument();
  });

  it("takes any radius up to 100 miles and says what the board searches", async () => {
    serve({ "/v1/scout/tracks": [TRACK], "/v1/scout/missions": [MISSION] });
    post.mockResolvedValue(MISSION);
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole("button", { name: /New search/ }));
    const form = await screen.findByRole("dialog");
    await user.type(
      within(form).getByLabelText(/City or area/),
      "Beaverton, OR",
    );
    const miles = within(form).getByLabelText(/How far around it/);
    expect(miles).toHaveValue(25);
    await user.clear(miles);
    await user.type(miles, "40");
    expect(
      within(form).getByText(/LinkedIn searches 50 miles/),
    ).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/missions",
      expect.objectContaining({ location: "Beaverton, OR", radius_miles: 40 }),
    );
  });

  it("asks a new user to set up resume types first", async () => {
    serve({ "/v1/scout/tracks": [], "/v1/scout/missions": [] });
    renderStart();
    expect(
      await screen.findByRole("button", { name: /set up resume types/i }),
    ).toBeInTheDocument();
  });

  it("with no resume types yet, Claude can still pick from the resume", async () => {
    serve({
      "/v1/scout/tracks": [],
      "/v1/scout/missions": [],
      "/v1/ai/resumes": [{ id: "cv", is_active: true }],
    });
    post.mockResolvedValue({ ...MISSION, broad: true });
    const user = userEvent.setup();
    renderStart();
    await user.click(
      await screen.findByRole("button", {
        name: "Or let Claude pick from your resume",
      }),
    );
    const form = await screen.findByRole("dialog");
    expect(
      within(form).getByRole("combobox", { name: "Resume type" }),
    ).toHaveTextContent("Anything I'd be good at");
    await user.click(within(form).getByRole("button", { name: "Save search" }));
    expect(post).toHaveBeenCalledWith(
      "/v1/scout/missions",
      expect.objectContaining({ broad: true }),
    );
  });

  it("someone with only broad searches still sees them", async () => {
    serve({
      "/v1/scout/tracks": [],
      "/v1/scout/missions": [
        { ...MISSION, broad: true, name: "LinkedIn · Anything I'd be good at" },
      ],
    });
    renderStart();
    expect(
      await screen.findByText("LinkedIn · Anything I'd be good at"),
    ).toBeInTheDocument();
  });
});

describe("Start after a run (spec 012)", () => {
  const DONE = {
    ...RUN,
    status: "done",
    note: "Few new ones today",
    finished_at: "2026-11-20T18:00:00Z",
    looked_at: { rows: 40 },
    bands: { best: 3, possible: 2, long_shot: 4 },
    hidden: { repeats: 5, too_far: 1 },
    not_copied: 2,
    widened: [{ title: "IT Systems Administrator", days: 3 }],
    suggested_titles: ["Help Desk Analyst"],
    looking_for: {
      source: "linkedin",
      track: "IT Admin",
      levels: ["entry", "mid"],
      location: "Springfield, IL",
      radius_miles: 25,
      remote: "any",
      days: 1,
      min_fit: 6,
    },
  };
  const REC = {
    mission: {
      job_count: 10,
      posted_within_days: 7,
      min_fit: 6,
      radius_miles: 25,
    },
    track: { levels: ["entry", "mid"], skip: { degree_only: false } },
  };

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  function renderWith(onOpenResults = vi.fn()) {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
      mutationCache: new MutationCache({ onError: () => {} }),
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ScoutStart onSetUpTypes={() => {}} onOpenResults={onOpenResults} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return onOpenResults;
  }

  it("shows the last run's numbers and opens its results", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
      "/v1/scout/runs": [DONE],
      "/v1/scout/recommended": REC,
    });
    const open = renderWith();
    const card = await screen.findByRole("region", { name: "Last run" });
    expect(
      within(card).getByText(
        "Looked for: Entry–mid IT Admin jobs · Springfield, IL + 25 mi · today · fit 6+",
      ),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Checked 40 jobs · 3 best · 2 possible · 4 long shots",
    );
    expect(card).toHaveTextContent(
      "Hidden: 5 you'd already seen · 1 too far away",
    );
    expect(card).toHaveTextContent(
      "widened IT Systems Administrator to 3 days",
    );
    expect(card).toHaveTextContent("Job Catcher didn't copy 2 pages");
    expect(card).toHaveTextContent("Few new ones today");
    await userEvent.click(
      within(card).getByRole("button", { name: /See results/ }),
    );
    expect(open).toHaveBeenCalledWith("r1");
  });

  it("keeps a title Claude suggested with one tap", async () => {
    serve({
      "/v1/scout/tracks": [{ ...TRACK, related_titles: [] }],
      "/v1/scout/missions": [MISSION],
      "/v1/scout/runs": [DONE],
    });
    patch.mockResolvedValue(TRACK);
    renderWith();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Keep Help Desk Analyst for IT Admin",
      }),
    );
    expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", {
      related_titles: ["Help Desk Analyst"],
    });
  });

  it("says how many new jobs are waiting, and opens them", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [MISSION],
    });
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/v1/scout/findings")
          ? {
              items: [],
              counts: {
                best: 3,
                possible: 2,
                long_shot: 6,
                new: 11,
                saved: 0,
                passed: 0,
                hidden: 0,
              },
              next: null,
            }
          : path === "/v1/scout/tracks"
            ? [TRACK]
            : path === "/v1/scout/missions"
              ? [MISSION]
              : [],
      ),
    );
    const open = renderWith();
    await userEvent.click(
      await screen.findByRole("button", { name: /5 new jobs waiting for you/ }),
    );
    expect(open).toHaveBeenCalledWith(null);
  });

  it("shows recommended settings' changes and applies them only on press", async () => {
    serve({
      "/v1/scout/tracks": [TRACK],
      "/v1/scout/missions": [
        { ...MISSION, job_count: 2, posted_within_days: 1, min_fit: 8 },
      ],
      "/v1/scout/recommended": REC,
    });
    patch.mockResolvedValue({});
    renderWith();
    await userEvent.click(
      await screen.findByRole("button", { name: /Use recommended settings/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Jobs per run2 → 10");
    expect(dialog).toHaveTextContent("Degree ruleSkip degree-only jobs → Off");
    expect(patch).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply" }),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/missions/m1", {
        job_count: 10,
        posted_within_days: 7,
        min_fit: 6,
        // A place with no distance set gets the recommended one.
        radius_miles: 25,
      }),
    );
    expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", {
      levels: ["entry", "mid"],
      skip_rules: { degree_only: false, max_years: null, exclude: [] },
    });
  });
});
