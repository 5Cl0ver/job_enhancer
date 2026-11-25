// Spec 030: Claude's questions as one checklist, changing a box while Claude
// fills, and the problems Claude ran into (on the application and for the admin).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    put: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ApplyProblemsCard } from "@/components/admin/ApplyProblemsCard";
import { LiveFill } from "@/components/apply/LiveFill";
import { Problems } from "@/components/apply/Problems";
import { Questions } from "@/components/apply/Questions";
import type { ApplyProblem, ApplyRun } from "@/lib/apply";

const RUN: ApplyRun = {
  id: "r1",
  status: "questions",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Northwind Labs", location: "" },
  apply_url: "https://northwind.example/apply",
  created_at: "2026-11-25T10:00:00Z",
  finished_at: null,
  questions_open: 3,
  help: null,
  review: null,
  note: null,
  questions: [
    // An earlier checklist, already answered: not on screen now.
    { id: "q0", question: "Have you used Okta?", why: null, answer: "Yes", skipped: false, batch: 1 },
    {
      id: "q1",
      question: "How did you hear about us?",
      why: null,
      answer: null,
      skipped: false,
      guess: "LinkedIn",
      choices: ["LinkedIn", "Company site"],
      batch: 2,
    },
    {
      id: "q2",
      question: "Years of Python?",
      why: null,
      answer: null,
      skipped: false,
      only_you: true,
      choices: ["1", "2", "3+"],
      batch: 2,
    },
    { id: "q3", question: "Notice period?", why: null, answer: null, skipped: false, guess: "Two weeks", batch: 2 },
  ],
  answers_done: false,
  pages: [],
  resume_id: "res1",
  document_id: null,
  events: [],
  started_at: null,
};

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("Claude's questions as one checklist", () => {
  it("shows the newest list, only-you first, with Claude's guesses filled in", () => {
    wrap(<Questions run={RUN} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("textbox").getAttribute("aria-labelledby"))).toEqual([
      "q-q2",
      "q-q1",
      "q-q3",
    ]);
    expect(screen.queryByText("Have you used Okta?")).not.toBeInTheDocument();
    // Only you can answer: highlighted, and the box is empty.
    expect(within(rows[0]).getByText("Only you can answer")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("textbox")).toHaveValue("");
    expect(within(rows[0]).getByRole("textbox")).toHaveAttribute("placeholder", "Only you know this");
    // Claude's guesses are in the boxes, marked as guesses.
    expect(within(rows[1]).getByRole("textbox")).toHaveValue("LinkedIn");
    expect(within(rows[1]).getByRole("button", { name: "LinkedIn" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("Claude's best guess")).toHaveLength(2);
    expect(screen.getByText("1 left empty: Claude skips it.")).toBeInTheDocument();
  });

  it("a quick answer fills the box, and one button sends them all", async () => {
    post.mockResolvedValue({ ...RUN, status: "filling", answers_done: true });
    wrap(<Questions run={RUN} />);
    await userEvent.click(screen.getByRole("button", { name: "3+" }));
    const notice = screen.getByRole("textbox", { name: "Notice period?" });
    await userEvent.clear(notice);
    await userEvent.type(notice, "One month");
    expect(screen.queryByText(/left empty/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Looks good, go" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/answers", {
        done: true,
        answers: [
          { id: "q2", answer: "3+" },
          { id: "q1", answer: "LinkedIn" },
          { id: "q3", answer: "One month" },
        ],
      }),
    );
  });
});

const FILLING: ApplyRun = {
  ...RUN,
  status: "filling",
  live: {
    url: "https://northwind.example/apply/2",
    title: "My Information",
    at: "2026-11-25T10:00:00Z",
    boxes: [
      { q: "Prefix", a: "Mr." },
      { q: "Salary", a: "$90,000", by: "job_catcher" },
    ],
  },
};

describe("change a box while Claude fills", () => {
  it("tap a box, change it, and it goes to Claude at once", async () => {
    post.mockResolvedValue(FILLING);
    wrap(<LiveFill run={FILLING} />);
    await userEvent.click(screen.getByRole("button", { name: /^Prefix: Mr\./ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Now: Mr.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send to Claude" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Change it to"), "None");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to Claude" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/live-fix", { q: "Prefix", a: "Mr.", to: "None" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("→ None (sent to Claude)")).toBeInTheDocument();
  });

  it("or asks Claude about it", async () => {
    post.mockResolvedValue(FILLING);
    wrap(<LiveFill run={FILLING} />);
    await userEvent.click(screen.getByRole("button", { name: /^Salary/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    await userEvent.type(screen.getByLabelText("Ask Claude"), "Is that too low?");
    await userEvent.click(screen.getByRole("button", { name: "Send to Claude" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/live-fix", {
        q: "Salary",
        a: "$90,000",
        ask: "Is that too low?",
      }),
    );
    expect(await screen.findByText("Asked Claude")).toBeInTheDocument();
  });
});

const PROBLEMS: ApplyProblem[] = [
  {
    id: "p1",
    at: "2026-11-25T10:00:00Z",
    kind: "job_catcher",
    what: "Job Catcher said no résumé box, but there is one",
    page: "https://northwind.example/apply/2",
    count: 2,
  },
  { id: "p2", at: "2026-11-25T10:05:00Z", kind: "tab", what: "The tab closed", page: null, count: 1 },
];

describe("problems Claude ran into", () => {
  it("is closed until tapped, then lists them newest first", async () => {
    wrap(<Problems problems={PROBLEMS} />);
    const toggle = screen.getByRole("button", { name: /Problems Claude ran into \(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The tab closed")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("The tab closed")).toBeInTheDocument();
    expect(within(items[1]).getByText("Job Catcher")).toBeInTheDocument();
    expect(within(items[1]).getByText("2 times")).toBeInTheDocument();
    expect(within(items[1]).getByText("northwind.example/apply/2")).toBeInTheDocument();
  });

  it("shows nothing when there are none", () => {
    const { container } = wrap(<Problems problems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the admin sees everyone's, with the job and who", async () => {
    get.mockResolvedValue([
      { ...PROBLEMS[0], run_id: "r1", status: "sent", user_email: "alex@example.com", job: "IT Engineer at Northwind Labs" },
    ]);
    wrap(<ApplyProblemsCard />);
    expect(await screen.findByText("IT Engineer at Northwind Labs · alex@example.com")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/v1/admin/apply-problems?limit=100");
  });
});
