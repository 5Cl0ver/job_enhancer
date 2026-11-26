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
  API_BASE: "http://localhost:8000",
}));

import { ApplyRunPage } from "@/routes/ApplyRunPage";
import { ApplyWithClaudeButton } from "@/components/apply/ApplyWithClaudeButton";
import { ApiError } from "@/lib/api";
import { APPLY_LINE, type ApplyRun } from "@/lib/apply";

const RUN: ApplyRun = {
  id: "r1",
  status: "waiting",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Acme", location: "" },
  apply_url: "https://acme.example/apply",
  created_at: "2026-11-24T10:00:00Z",
  finished_at: null,
  questions_open: 0,
  help: null,
  review: null,
  note: null,
  questions: [],
  answers_done: false,
  pages: [],
  resume_id: null,
  document_id: null,
  events: [{ at: "2026-11-24T10:00:00Z", kind: "pressed", text: "You pressed Apply with Claude." }],
  started_at: null,
};

function serve(run: ApplyRun) {
  get.mockImplementation((path: string) => {
    if (path === "/v1/apply/runs/r1") return Promise.resolve(run);
    if (path.startsWith("/v1/ai/resumes")) return Promise.resolve([]);
    if (path.startsWith("/v1/saved-jobs")) return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/apply/r1"]}>
        <Routes>
          <Route path="/apply/:runId" element={<ApplyRunPage />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("the application page", () => {
  it("starts with the line to paste into Claude", async () => {
    serve(RUN);
    renderPage();
    expect(await screen.findByText(APPLY_LINE)).toBeInTheDocument();
    expect(screen.getByText("Waiting for Claude…")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent until you check the photos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to the job/ })).toHaveAttribute("href", "/jobs/l1");
  });

  it("answers Claude's checklist with quick answers (spec 030)", async () => {
    serve({
      ...RUN,
      status: "questions",
      questions_open: 2,
      questions: [
        {
          id: "q1",
          question: "Have you used Okta?",
          why: "Okta experience",
          answer: null,
          skipped: false,
          choices: ["Yes", "No"],
          only_you: true,
        },
        { id: "q2", question: "Have you used Jamf?", why: null, answer: null, skipped: false },
      ],
    });
    post.mockResolvedValue({ ...RUN, status: "writing" });
    renderPage();
    await screen.findByText("Have you used Okta?");
    // What Claude waits for comes first: before the chat, and no empty screen card.
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Claude's questions")).toBeLessThan(headings.indexOf("Talk to Claude"));
    expect(headings).not.toContain("The screen");
    expect(screen.getByText("The listing says: “Okta experience”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    const box = screen.getByRole("textbox", { name: "Have you used Okta?" });
    await userEvent.type(box, ". SSO for 40 apps");
    expect(screen.getByText("1 left empty: Claude skips it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Looks good, go" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/answers", {
        done: true,
        answers: [
          { id: "q1", answer: "Yes. SSO for 40 apps" },
          { id: "q2", skipped: true },
        ],
      }),
    );
  });

  it("asks for help and goes on when the user is done", async () => {
    serve({
      ...RUN,
      status: "needs_you",
      help: { kind: "sign_up", what: "Make a Workday account with your email.", at: "", done_at: null },
    });
    post.mockResolvedValue({ ...RUN, status: "filling" });
    renderPage();
    expect(await screen.findByText("Make a Workday account with your email.")).toBeInTheDocument();
    expect(screen.getByText(/never sees or stores your passwords/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done, keep going" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/help-done", { reply: null }));
  });

  it("the review: photos and answers, then Submit or a fix", async () => {
    serve({
      ...RUN,
      status: "review",
      review: { round: 1, decision: null, note: null, by: null, at: null },
      pages: [
        {
          n: 1,
          url: "https://acme.example/apply/1",
          title: "My Information",
          answers: [{ q: "Why Acme?", a: "I like it", claude: true }],
          jc_answers: [],
          photo_ids: ["p1", "p2"],
          photo: "taken",
          reason: null,
          at: "",
          round: 1,
          last: false,
        },
        {
          n: 2,
          url: "https://acme.example/apply/2",
          title: "Review",
          answers: [{ q: "Start date", a: "" }],
          jc_answers: [],
          photo_ids: [],
          photo: "missing",
          reason: "The tab wasn't showing",
          at: "",
          round: 1,
          last: true,
        },
      ],
    });
    post.mockResolvedValue({ ...RUN, status: "review" });
    renderPage();
    expect(await screen.findByText("Page 1: My Information")).toBeInTheDocument();
    expect(screen.getAllByText("Claude wrote it")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Left empty")).toHaveLength(2); // checked first, and on its page
    expect(screen.getByText(/No photo: The tab wasn't showing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open photo 1 of page 1" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Fix something/ }));
    await userEvent.type(screen.getByLabelText("What should Claude fix?"), "Start date is January");
    await userEvent.click(screen.getByRole("button", { name: "Send to Claude" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/decision", {
        decision: "fix",
        note: "Start date is January",
      }),
    );
  });

  it("Submit tells Claude to press it", async () => {
    serve({ ...RUN, status: "review", review: { round: 1, decision: null, note: null, by: null, at: null } });
    post.mockResolvedValue({ ...RUN, status: "review" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/decision", { decision: "submit", note: undefined }),
    );
  });
});

describe("Apply with Claude button", () => {
  function renderButton() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/jobs/l1"]}>
          <Routes>
            <Route path="/jobs/:id" element={<ApplyWithClaudeButton savedJobId="s1" />} />
            <Route path="/apply/:runId" element={<p>application page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("starts a run and opens its page", async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue(RUN);
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "Apply with Claude" }));
    // No résumé on the job: Claude makes one.
    expect(await screen.findByRole("radio", { name: /Make one for this job/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("application page")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/v1/apply/runs", { saved_job_id: "s1", resume_id: null });
  });

  it("uses the job's résumé, or another one, so Claude doesn't write one", async () => {
    const resumes = [
      { id: "made", filename: "Sam_Acme.pdf", document_id: "d1", is_active: false },
      { id: "mine", filename: "Sam.pdf", document_id: null, is_active: true },
      { id: "old", filename: "Sam_old.pdf", document_id: null, is_active: false },
    ];
    get.mockImplementation((path: string) => {
      if (path.startsWith("/v1/ai/resumes")) return Promise.resolve(resumes);
      if (path.startsWith("/v1/saved-jobs")) return Promise.resolve([{ id: "s1", job_listing_id: "l1", resume_id: "made", job_listing: { id: "l1", title: "IT Engineer", company: "Acme" } }]);
      return Promise.resolve([]);
    });
    post.mockResolvedValue(RUN);
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "Apply with Claude" }));
    const onJob = await screen.findByRole("radio", { name: /Use the one on this job/ });
    expect(onJob).toHaveAttribute("aria-checked", "true");
    expect(onJob).toHaveTextContent("Sam_Acme.pdf");
    expect(screen.getByText(/skips the questions/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Use another résumé/ }));
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    const list = screen.getByRole("combobox", { name: "Your résumés" });
    // Your own résumés only, never another job's made one.
    expect([...list.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Choose…", "Sam.pdf", "Sam_old.pdf"]);
    await userEvent.selectOptions(list, "old");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("application page");
    expect(post).toHaveBeenCalledWith("/v1/apply/runs", { saved_job_id: "s1", resume_id: "old" });
  });

  it("offers the open one when another is going", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/apply/runs/open" ? { ...RUN, id: "r9" } : []),
    );
    post.mockRejectedValue(new ApiError(409, "Another application is already going."));
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "Apply with Claude" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByRole("link", { name: "Open it" })).toHaveAttribute("href", "/apply/r9");
  });

  it("a job with an application going opens it", async () => {
    get.mockResolvedValue([{ ...RUN, status: "filling" }]);
    renderButton();
    expect(await screen.findByRole("button", { name: /Open application/ })).toBeInTheDocument();
  });
});


describe("after the review fixes", () => {
  it("an answer given in the chat shows, and isn't sent back as skipped", async () => {
    serve({
      ...RUN,
      status: "questions",
      questions_open: 1,
      questions: [
        { id: "q1", question: "Have you used Okta?", why: null, answer: "No. Never used it", skipped: false, source: "chat" },
        { id: "q2", question: "Have you used Jamf?", why: null, answer: null, skipped: false },
      ],
    });
    post.mockResolvedValue({ ...RUN, status: "writing" });
    renderPage();
    expect(await screen.findByDisplayValue("No. Never used it")).toBeInTheDocument();
    expect(screen.getByText("1 left empty: Claude skips it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Looks good, go" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/answers", { done: true, answers: [{ id: "q2", skipped: true }] }),
    );
  });

  it("a stopped run never looks sent", async () => {
    serve({ ...RUN, status: "stopped", note: "You stopped it." });
    renderPage();
    expect(await screen.findByText("Stopped: You stopped it.")).toBeInTheDocument();
    expect(screen.getByLabelText("Stopped here")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sent" })).not.toBeInTheDocument();
  });

  it("shows what the user told Claude, and the answer can still be changed", async () => {
    serve({
      ...RUN,
      status: "review",
      review: { round: 1, decision: "submit", note: null, by: "chat", words: "looks good, submit", at: "" },
    });
    renderPage();
    expect(await screen.findByText("looks good, submit")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change my answer" }));
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("Stop asks first", async () => {
    serve(RUN);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    expect(confirm).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("look over the résumé (spec 025)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("waits for Use it, or sends what to change", async () => {
    const run: ApplyRun = {
      ...RUN,
      status: "resume_review",
      resume_id: "made",
      document_id: "d1",
      resume_check: { round: 1, decision: null, note: null, at: null },
    };
    get.mockImplementation((path: string) => {
      if (path === "/v1/apply/runs/r1") return Promise.resolve(run);
      if (path === "/v1/users/me") return Promise.resolve({ id: "u", email: "a@b.c", review_resumes: true });
      if (path.startsWith("/v1/ai/resumes")) return Promise.resolve([{ id: "made", filename: "Sam_Acme.pdf", document_id: "d1" }]);
      if (path.startsWith("/v1/ai/documents")) return Promise.resolve({ id: "d1", content: "# Sam", edited_content: null });
      return Promise.resolve([]);
    });
    post.mockResolvedValue({ ...run, resume_check: { ...run.resume_check!, decision: "change", note: "Lead with Intune" } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/apply/r1"]}>
          <Routes>
            <Route path="/apply/:runId" element={<ApplyRunPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Look over your résumé" })).toBeInTheDocument();
    expect(screen.getByText("Your résumé is ready to look over")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use it" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change something" }));
    const send = screen.getByRole("button", { name: "Send to Claude" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "What should Claude change?" }), "Lead with Intune");
    await userEvent.click(send);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/resume-decision", { decision: "change", note: "Lead with Intune" }),
    );
  });
});


describe("the cover letter on the application page (spec 031)", () => {
  it("shows the job's letter beside the résumé", async () => {
    serve({ ...RUN, status: "filling", cover_letter: { id: "cl1", filename: "Alex Rivera - Cover letter.pdf" }, cover_letter_written: true });
    renderPage();
    expect(await screen.findByText("Alex Rivera - Cover letter.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Alex Rivera - Cover letter.pdf" })).toBeInTheDocument();
  });

  it("says None when Claude wrote one but the job now has none", async () => {
    serve({ ...RUN, status: "filling", cover_letter: null, cover_letter_written: true });
    renderPage();
    expect(await screen.findByText(/None for this job/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View .*Cover letter/ })).toBeNull();
  });

  it("no card when there's no letter at all", async () => {
    serve({ ...RUN, status: "filling" });
    renderPage();
    expect((await screen.findAllByText(/IT Engineer/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/None for this job/)).toBeNull();
    expect(screen.queryByText("Cover letter")).toBeNull();
  });
});
