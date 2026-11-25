import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
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

import { LiveFill } from "@/components/apply/LiveFill";
import { ReviewBoard } from "@/components/apply/Review";
import type { ApplyPage, ApplyRun } from "@/lib/apply";

const PAGE: ApplyPage = {
  n: 1,
  url: "https://acme.example/apply/1",
  title: "My Information",
  answers: [
    { q: "First name", a: "Sam", by: "job_catcher" },
    { q: "Prefix", a: "Mr.", guess: true },
    { q: "Salary", a: "$90,000", guess: true },
    { q: "I certify this is true", a: "Yes", agreement: true },
  ],
  jc_answers: [],
  photo_ids: [],
  photo: "missing",
  reason: "The computer was locked, so no photo (the answers are kept)",
  at: "2026-11-25T10:00:00Z",
  round: 1,
  last: true,
  resume: "attached",
};

const RUN: ApplyRun = {
  id: "r1",
  status: "review",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Acme", location: "" },
  apply_url: "https://acme.example/apply",
  created_at: "2026-11-25T10:00:00Z",
  finished_at: null,
  questions_open: 0,
  help: null,
  review: { round: 1, decision: null, note: null, by: null, at: null },
  note: null,
  questions: [],
  answers_done: true,
  pages: [PAGE],
  resume_id: null,
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

const checkList = () => screen.getByRole("heading", { name: "Check these first" }).parentElement!;

describe("answer bubbles (spec 026)", () => {
  beforeEach(() => post.mockReset());

  it("shows what to check first, and sends every fix together", async () => {
    post.mockResolvedValue({ ...RUN, review: { ...RUN.review!, decision: "fix" } });
    wrap(<ReviewBoard run={RUN} />);
    const bubbles = within(checkList()).getAllByRole("button");
    // The agreement first, then the guesses; Job Catcher's sure answer isn't here.
    expect(bubbles.map((b) => b.getAttribute("aria-label")?.split(":")[0])).toEqual([
      "I certify this is true",
      "Prefix",
      "Salary",
    ]);
    expect(within(checkList()).getByText("You're agreeing")).toBeInTheDocument();
    expect(within(checkList()).getAllByText("Claude guessed")).toHaveLength(2);
    expect(screen.getByText(/Résumé attached/)).toBeInTheDocument();
    expect(screen.getByText(/The computer was locked/)).toBeInTheDocument();

    await userEvent.click(bubbles[1]);
    await userEvent.type(screen.getByLabelText("Change it to"), "None");
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));
    await userEvent.click(within(checkList()).getAllByRole("button")[2]);
    await userEvent.type(screen.getByLabelText("Or ask Claude about it"), "Is that too low?");
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));

    expect(screen.getByText("2 fixes ready")).toBeInTheDocument();
    expect(within(checkList()).getByText("→ None")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send fixes" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/decision", {
        decision: "fix",
        fixes: [
          { page: 1, q: "Prefix", a: "Mr.", to: "None" },
          { page: 1, q: "Salary", a: "$90,000", ask: "Is that too low?" },
        ],
      }),
    );
  });

  it("asks before Submit when fixes weren't sent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    wrap(<ReviewBoard run={RUN} />);
    await userEvent.click(within(checkList()).getAllByRole("button")[1]);
    await userEvent.type(screen.getByLabelText("Change it to"), "None");
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(confirm).toHaveBeenCalledWith("You have 1 fix not sent. Submit anyway?");
    expect(post).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("can't be changed once decided", () => {
    wrap(<ReviewBoard run={{ ...RUN, review: { ...RUN.review!, decision: "submit" } }} />);
    expect(within(checkList()).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("Filling now (spec 026)", () => {
  it("lists the page's boxes while filling", () => {
    wrap(
      <LiveFill
        run={{
          ...RUN,
          status: "filling",
          live: {
            url: "https://acme.example/apply/2",
            title: "My Experience",
            at: "2026-11-25T10:00:00Z",
            boxes: [
              { q: "Job title", a: "IT Engineer", by: "job_catcher" },
              { q: "Why Acme?", a: "" },
            ],
          },
        }}
      />,
    );
    const live = screen.getByRole("region", { name: "Filling now" });
    expect(within(live).getByText("Filling now: My Experience")).toBeInTheDocument();
    expect(within(live).getByText("1 of 2 filled")).toBeInTheDocument();
    expect(within(live).getByText("IT Engineer")).toBeInTheDocument();
    expect(within(live).getByText("Job Catcher")).toBeInTheDocument();
  });

  it("is gone at the review", () => {
    const { container } = wrap(<LiveFill run={RUN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for a newer Job Catcher when it can't read the page", () => {
    wrap(
      <LiveFill
        run={{
          ...RUN,
          status: "filling",
          live: null,
          job_catcher: {
            version: "0.41.0",
            last_seen_at: null,
            ready: true,
            new_enough: true,
            live: false,
            needs: "0.41.0",
          },
        }}
      />,
    );
    expect(screen.getByText("Update Job Catcher to watch the boxes fill here.")).toBeInTheDocument();
  });
});
