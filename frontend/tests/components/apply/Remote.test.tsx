// Spec 023: the application page as a remote control — answer Claude, talk to
// it, see the screen, know it stopped, be sure it was sent, Job Catcher ready.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "https://api.example.com",
}));

import { ApplyRunPage } from "@/routes/ApplyRunPage";
import { APPLY_LINE, CARRY_ON_LINE, type ApplyRun } from "@/lib/apply";

const READY = { version: "0.41.0", last_seen_at: "2026-11-25T10:00:00Z", ready: true, needs: "0.41.0" };

const RUN: ApplyRun = {
  id: "r1",
  status: "filling",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Acme", location: "" },
  apply_url: "https://acme.example/apply",
  created_at: "2026-11-25T10:00:00Z",
  finished_at: null,
  questions_open: 0,
  help: null,
  review: null,
  note: null,
  questions: [],
  answers_done: true,
  pages: [],
  resume_id: null,
  document_id: null,
  events: [],
  started_at: "2026-11-25T10:00:00Z",
  messages: [],
  peeks: [],
  claude_at: "2026-11-25T10:01:00Z",
  claude_stopped: false,
  ask_if_sent: false,
  job_catcher: READY,
};

function serve(run: ApplyRun) {
  get.mockImplementation((path: string) => {
    if (path === "/v1/apply/runs/r1") return Promise.resolve(run);
    if (path.startsWith("/v1/ai/resumes") || path.startsWith("/v1/saved-jobs")) return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/apply/r1"]}>
        <Routes>
          <Route path="/apply/:runId" element={<ApplyRunPage />} />
          <Route path="/job-catcher" element={<p>job catcher page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue(RUN);
});

describe("answer Claude from the app", () => {
  const asking = {
    ...RUN,
    status: "needs_you" as const,
    help: {
      kind: "question" as const,
      what: "Can Acme reach out by SMS?",
      at: "",
      done_at: null,
      choices: ["Yes", "No"],
      reply: null,
    },
    peeks: [{ id: "p1", at: "2026-11-25T10:02:00Z" }],
  };

  it("a quick answer goes to Claude in one tap, next to a photo of the screen", async () => {
    serve(asking);
    renderPage();
    expect(await screen.findByText("Can Acme reach out by SMS?")).toBeInTheDocument();
    expect(await screen.findByAltText("The application's screen")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/help-done", { reply: "No" }));
  });

  it("or any answer, typed", async () => {
    serve({ ...asking, help: { ...asking.help, what: "What pay do you expect?", choices: [] } });
    renderPage();
    await userEvent.type(await screen.findByLabelText("Your answer for Claude"), "$120,000");
    await userEvent.click(screen.getByRole("button", { name: /Send to Claude/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/help-done", { reply: "$120,000" }));
  });

  it("a CAPTCHA says it needs you at the computer", async () => {
    serve({ ...asking, help: { ...asking.help, kind: "captcha", what: "Solve the I'm not a robot box.", choices: [] } });
    renderPage();
    expect(await screen.findByText(/This one needs you at the computer/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your answer for Claude")).toBeNull();
  });
});

describe("talk to Claude", () => {
  it("shows the conversation and sends a message", async () => {
    serve({
      ...RUN,
      messages: [
        { id: "m1", by: "claude", text: "Page 1 of 3 done", at: "2026-11-25T10:03:00Z", read: true },
        { id: "m2", by: "you", text: "Use my Gmail", at: "2026-11-25T10:04:00Z", read: true },
      ],
    });
    renderPage();
    expect(await screen.findByText("Page 1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText(/Read by Claude/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message Claude"), "Stop at the review");
    await userEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/messages", { text: "Stop at the review" }),
    );
  });

  it("asks for the screen now", async () => {
    serve(RUN);
    post.mockResolvedValue({ request_id: "q1" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Show me the screen/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/peek", {}));
    expect(await screen.findByText("Asking Job Catcher…")).toBeInTheDocument();
  });
});

describe("knowing where it stands", () => {
  it("says when Claude stopped, with the line to carry on", async () => {
    serve({ ...RUN, claude_stopped: true });
    renderPage();
    expect(await screen.findByText("Claude seems to have stopped")).toBeInTheDocument();
    expect(screen.getByText(CARRY_ON_LINE)).toBeInTheDocument();
  });

  it("asks if it went through, and either answer is one tap", async () => {
    const asking = { ...RUN, status: "submitting" as const, ask_if_sent: true };
    serve(asking);
    post.mockResolvedValue(asking);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /It was sent/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/sent", {}));
    await userEvent.click(screen.getByRole("button", { name: /It wasn't: Claude fixes it/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/not-sent", {}));
  });

  it("sent, confirmed: what Job Catcher saw", async () => {
    serve({
      ...RUN,
      status: "sent",
      review: {
        round: 1,
        decision: "submit",
        note: null,
        by: "app",
        at: "",
        confirmed: { words: "Thank you for applying!", at: "" },
      },
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: /Sent, confirmed/ })).toBeInTheDocument();
    expect(screen.getByText("Job Catcher saw: “Thank you for applying!”")).toBeInTheDocument();
  });

  it("warns when Job Catcher is out of date", async () => {
    serve({ ...RUN, job_catcher: { version: "0.39.0", last_seen_at: "", ready: false, needs: "0.41.0" } });
    renderPage();
    expect(await screen.findByText("Update Job Catcher for photos and filling")).toBeInTheDocument();
    expect(screen.getByText(/You have Job Catcher 0.39.0; this needs 0.41.0/)).toBeInTheDocument();
  });

  it("the start says any AI with the connector works", async () => {
    serve({ ...RUN, status: "waiting" });
    renderPage();
    expect(await screen.findByText(APPLY_LINE)).toBeInTheDocument();
    expect(screen.getByText("https://api.example.com/mcp")).toBeInTheDocument();
  });
});


describe("after the review fixes", () => {
  it("never shows an older page's photo as the screen Claude asks about", async () => {
    serve({
      ...RUN,
      status: "needs_you",
      help: { kind: "question", what: "Pay?", at: "2026-11-25T10:05:00Z", done_at: null, choices: [], peek_request: "k1" },
      peeks: [{ id: "p-old", at: "2026-11-25T10:01:00Z" }],
    });
    renderPage();
    expect(await screen.findByText("Taking a photo of this screen…")).toBeInTheDocument();
    expect(screen.queryByAltText("The application's screen")).toBeNull();
  });

  it("long quick answers wrap instead of pushing the page sideways", async () => {
    const long = "Yes, I'm authorized to work in the US without sponsorship";
    serve({
      ...RUN,
      status: "needs_you",
      help: { kind: "question", what: "Work authorization?", at: "", done_at: null, choices: [long] },
    });
    renderPage();
    expect((await screen.findByRole("button", { name: long })).className).toContain("whitespace-normal");
  });

  it("an up-to-date Job Catcher that's asleep isn't told to update", async () => {
    serve({ ...RUN, job_catcher: { version: "0.41.0", last_seen_at: "", ready: false, new_enough: true, needs: "0.41.0" } });
    renderPage();
    expect(await screen.findByText(/hasn't checked in lately/)).toBeInTheDocument();
    expect(screen.queryByText("Update Job Catcher for photos and filling")).toBeNull();
  });

  it("never both 'stopped' and 'did it go through?'", async () => {
    serve({ ...RUN, status: "submitting", ask_if_sent: true, claude_stopped: true });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Did it go through?" })).toBeInTheDocument();
    expect(screen.queryByText("Claude seems to have stopped")).toBeNull();
  });

  it("the screen button waits for a NEW photo, whatever the clocks say", async () => {
    serve({ ...RUN, peeks: [{ id: "p1", at: "2030-01-01T00:00:00Z" }] }); // a server clock far ahead
    post.mockResolvedValue({ request_id: "q1" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Show me the screen/ }));
    expect(await screen.findByText("Asking Job Catcher…")).toBeInTheDocument();
  });
});
