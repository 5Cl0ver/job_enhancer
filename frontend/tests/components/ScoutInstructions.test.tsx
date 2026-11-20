import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { RunLog } from "@/components/scout/RunLog";
import { ScoutInstructions } from "@/components/scout/ScoutInstructions";
import { instructionsLine } from "@/lib/scout";

const RUBRIC = { skills: 4, experience: 2, title_level: 2, recency: 1, pay_location: 1 };
const LABELS = {
  skills: "skills match",
  experience: "years/degree met",
  title_level: "title and level",
  recency: "posted recently",
  pay_location: "pay and location",
};
function text(key: string, title: string, current = `${title} original.`, edited = false) {
  return {
    key,
    title,
    kind: "text",
    original: `${title} original.`,
    current,
    edited,
    edited_at: edited ? "2026-11-21T10:00:00Z" : null,
    original_changed: false,
  };
}
const INSTRUCTIONS = {
  sections: [
    text("playbook", "Main steps", "1. Look at hospital jobs.", true),
    text("google_jobs", "Extra steps: Google Jobs"),
    text("local_companies", "Extra steps: Local companies"),
    text("broad", "Extra steps: Anything I'd be good at"),
    {
      key: "rubric",
      title: "Scoring",
      kind: "rubric",
      original: RUBRIC,
      current: RUBRIC,
      edited: false,
      edited_at: null,
      original_changed: false,
      labels: LABELS,
    },
    {
      key: "limits",
      title: "Limits",
      kind: "limits",
      original: { pages: 4, titles: 8, companies: 15 },
      current: { pages: 4, titles: 8, companies: 15 },
      edited: false,
      edited_at: null,
      original_changed: false,
      ranges: { pages: [1, 8], titles: [2, 8], companies: [5, 25] },
      labels: { pages: "Results pages a run reads", titles: "Titles", companies: "Companies" },
    },
  ],
  rubric_text: "Rubric (out of 10, judged against the resume): skills match 4 …",
  locked_rules: "These rules always apply:\n- Never apply to a job.",
  connector_note: "Tools to help the user find jobs.",
  tools: [{ name: "check_jobs", description: "Which jobs on this results page are new?" }],
  fixed_limits: [{ label: "Titles that didn't fit are skipped for", value: "30 days" }],
};

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Scout instructions", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    get.mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/scout/instructions" ? INSTRUCTIONS : []),
    );
  });

  it("shows every part, marked original or edited, and the locked ones", async () => {
    renderWith(<ScoutInstructions />);
    const main = await screen.findByRole("button", { name: /Main steps/ });
    expect(main).toHaveTextContent(/Edited/);
    expect(screen.getByRole("button", { name: /Extra steps: Google Jobs/ })).toHaveTextContent(
      "Original",
    );
    // The rules are open from the start, with no way to edit them.
    expect(screen.getByText(/Never apply to a job/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Locked").length).toBeGreaterThan(0);
    await userEvent.setup().click(
      screen.getByRole("button", { name: /What each tool tells Claude/ }),
    );
    expect(screen.getByText("check_jobs")).toBeInTheDocument();
  });

  it("edits the main steps, saves, and resets", async () => {
    put.mockResolvedValue({ ...INSTRUCTIONS.sections[0], current: "Mine." });
    post.mockResolvedValue({ ...INSTRUCTIONS.sections[0], current: "Main steps original.", edited: false });
    const user = userEvent.setup();
    renderWith(<ScoutInstructions />);
    await user.click(await screen.findByRole("button", { name: /Main steps/ }));
    const box = screen.getByLabelText("Main steps");
    expect(box).toHaveValue("1. Look at hospital jobs.");
    await user.clear(box);
    await user.type(box, "Mine.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/v1/scout/instructions/playbook", { text: "Mine." }),
    );
    await user.click(screen.getByRole("button", { name: /Reset to original/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/scout/instructions/playbook/reset", {}),
    );
  });

  it("scoring must add up to 10 before it saves", async () => {
    put.mockResolvedValue(INSTRUCTIONS.sections[4]);
    const user = userEvent.setup();
    renderWith(<ScoutInstructions />);
    await user.click(await screen.findByRole("button", { name: /Scoring/ }));
    const skills = screen.getByLabelText("skills match");
    await user.clear(skills);
    await user.type(skills, "5");
    expect(screen.getByText("Total: 11 of 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const recency = screen.getByLabelText("posted recently");
    await user.clear(recency);
    await user.type(recency, "0");
    expect(screen.getByText("Total: 10 of 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/v1/scout/instructions/rubric", {
        values: { ...RUBRIC, skills: 5, recency: 0 },
      }),
    );
  });

  it("restores an earlier version from history", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/scout/instructions"
          ? INSTRUCTIONS
          : path === "/v1/scout/instructions/playbook/history"
            ? [
                { id: "v2", created_at: "2026-11-21T10:00:00Z", reset: false, body: "Now." },
                { id: "v1", created_at: "2026-11-20T10:00:00Z", reset: false, body: "Before." },
              ]
            : [],
      ),
    );
    post.mockResolvedValue({ ...INSTRUCTIONS.sections[0], current: "Before." });
    const user = userEvent.setup();
    renderWith(<ScoutInstructions />);
    await user.click(await screen.findByRole("button", { name: /Main steps/ }));
    await user.click(screen.getByRole("button", { name: "History" }));
    const list = await screen.findByRole("list", { name: "Earlier versions" });
    expect(within(list).getAllByRole("button", { name: "Restore" })).toHaveLength(1);
    await user.click(within(list).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/scout/instructions/playbook/restore/v1", {}),
    );
  });

  it("previews what Claude would get, without starting anything", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/scout/instructions"
          ? INSTRUCTIONS
          : path === "/v1/scout/missions"
            ? [{ id: "m1", name: "LinkedIn · IT Admin · 5 · today" }]
            : path === "/v1/scout/missions/m1/preview"
              ? {
                  run_id: null,
                  preview: true,
                  playbook: "1. Look at hospital jobs.\n\nThese rules always apply:",
                  min_fit: 7,
                }
              : [],
      ),
    );
    const user = userEvent.setup();
    renderWith(<ScoutInstructions />);
    await user.click(await screen.findByRole("button", { name: /What Claude would get/ }));
    await user.click(screen.getByRole("combobox", { name: "Search to preview" }));
    await user.click(await screen.findByRole("option", { name: /IT Admin/ }));
    const brief = await screen.findByLabelText("What Claude would get");
    expect(within(brief).getByText(/These rules always apply/)).toBeInTheDocument();
    expect(within(brief).getByText("min fit")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Run log", () => {
  beforeEach(() => get.mockReset());

  it("lists each call in plain words, with the detail behind a tap", async () => {
    get.mockResolvedValue([
      {
        id: "e1",
        created_at: "2026-11-21T10:00:00Z",
        tool: "check_jobs",
        summary: "Checked 25 jobs on page 1: 6 to open",
        ok: true,
        request: { rows: [{ title: "IT Systems Administrator" }] },
        response: { open: [0] },
      },
      {
        id: "e2",
        created_at: "2026-11-21T10:01:00Z",
        tool: "check_jobs",
        summary: "Refused: Send at most 30 rows per call (one page).",
        ok: false,
        request: { rows: [] },
        response: { error: "Send at most 30 rows per call (one page)." },
      },
    ]);
    const user = userEvent.setup();
    renderWith(<RunLog runId="r1" />);
    await user.click(screen.getByRole("button", { name: /Log: what Claude and the app said/ }));
    const log = await screen.findByRole("list", { name: "Run log" });
    expect(within(log).getByText("Checked 25 jobs on page 1: 6 to open")).toBeInTheDocument();
    expect(within(log).getByLabelText("Refused")).toBeInTheDocument();
    await user.click(within(log).getByText("Checked 25 jobs on page 1: 6 to open"));
    expect(within(log).getByText("Claude sent")).toBeInTheDocument();
    expect(within(log).getByText(/IT Systems Administrator/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/v1/scout/runs/r1/log");
  });

  it("says which instructions a run used", () => {
    expect(instructionsLine(null)).toBeNull();
    expect(instructionsLine({ playbook: null, rubric: null })).toBe(
      "Instructions: the originals",
    );
    expect(
      instructionsLine({ playbook: "2026-11-21T10:00:00+00:00", rubric: null }),
    ).toMatch(/^Instructions: Main steps: edited .+ · the rest original$/);
  });
});
