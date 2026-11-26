// The review (spec 026, built from the one sheet since spec 033): what to
// check first (each question once), every answer by step, and the fixes
// waiting in the tray, sent together.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRun } from "./fakeRun";

let server: ReturnType<typeof fakeRun>;

vi.mock("@/lib/api", () => ({
  api: {
    get: (path: string) => server.get(path),
    post: (path: string, body?: Record<string, unknown>) => server.post(path, body),
    patch: (path: string, body?: Record<string, unknown>) => server.patch(path, body),
    put: vi.fn(),
    delete: (path: string) => server.delete(path),
    getBlob: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ReviewBoard } from "@/components/apply/Review";
import { useApplyRun } from "@/hooks/useApply";
import { type ApplyPage, type ApplyRun, checkRows, sheetFromPages } from "@/lib/apply";

const VET = "Please select your veteran status";

const page = (n: number, title: string, answers: ApplyPage["answers"]): ApplyPage => ({
  n,
  url: "https://acme.wd1.myworkdayjobs.com/apply",
  title,
  answers,
  jc_answers: [],
  photo_ids: [],
  photo: "missing",
  reason: "The computer was locked, so no photo (the answers are kept)",
  at: "2026-11-25T10:00:00Z",
  round: 1,
  last: false,
});

const RUN: ApplyRun = {
  id: "r1",
  status: "review",
  mode: "page",
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
  pages: [],
  resume_id: null,
  document_id: null,
  events: [],
  started_at: null,
  fixes: [],
  sheet: {
    steps: [
      {
        key: "my information",
        title: "My Information",
        n: 1,
        done: true,
        rows: [
          { q: "First name", a: "Sam", by: "job_catcher", tag: "profile" },
          { q: "Prefix", a: "Mr.", guess: true, tag: "guess", options: ["Mr.", "Ms."] },
          { q: "Salary", a: "$90,000", guess: true, tag: "guess" },
        ],
      },
      {
        key: "review",
        title: "Review",
        n: 2,
        done: true,
        rows: [{ q: "I certify this is true", a: "Yes", agreement: true, tag: "agreement" }],
      },
    ],
  },
};

function Live() {
  const { data } = useApplyRun("r1");
  return data ? <ReviewBoard run={data} /> : null;
}

function show(run: ApplyRun) {
  server = fakeRun(run);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Live />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const checkList = () => screen.getByRole("list", { name: "Check these first" });

describe("the review", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows what to check first, and sends every fix together", async () => {
    show(RUN);
    await screen.findByRole("heading", { name: "Check these first" });
    const rows = within(checkList()).getAllByRole("button");
    // The agreement first, then the guesses; Job Catcher's sure answer isn't here.
    expect(rows.map((b) => b.getAttribute("aria-label")?.split(":")[0])).toEqual([
      "I certify this is true",
      "Prefix",
      "Salary",
    ]);
    expect(within(checkList()).getByText("You're agreeing")).toBeInTheDocument();
    expect(within(checkList()).getAllByText("Claude guessed")).toHaveLength(2);

    await userEvent.click(rows[1]);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Ms." }));
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));
    await userEvent.click(await within(checkList()).findByRole("button", { name: /^Salary/ }));
    await userEvent.type(screen.getByLabelText("Change it to"), "$95,000");
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));

    expect(await screen.findByRole("button", { name: "2 fixes waiting" })).toBeInTheDocument();
    expect(within(checkList()).getByText("→ Ms. (waiting)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send fixes" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/v1/apply/runs/r1/fixes/send")).toBe(true));
    expect(server.now().fixes?.map((f) => f.status)).toEqual(["sent", "sent"]);
  });

  it("asks before Submit when fixes weren't sent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show({
      ...RUN,
      fixes: [{ id: "a", step: "my information", q: "Prefix", k: 1, now: "Mr.", to: "Ms.", status: "waiting", at: "" }],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(confirm).toHaveBeenCalledWith("You have 1 fix not sent. Go on without them?");
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a typed fix goes to Claude (the waiting ones go with it, on the server)", async () => {
    show(RUN);
    await userEvent.click(await screen.findByRole("button", { name: /Fix something/ }));
    await userEvent.type(screen.getByLabelText("What should Claude fix?"), "Also say hybrid is fine");
    await userEvent.click(screen.getByRole("button", { name: "Send to Claude" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST")).toEqual({
        method: "POST",
        path: "/v1/apply/runs/r1/decision",
        body: { decision: "fix", note: "Also say hybrid is fine" },
      }),
    );
  });

  it("can't be changed once decided", async () => {
    show({ ...RUN, review: { ...RUN.review!, decision: "submit" } });
    await screen.findByRole("heading", { name: "Check these first" });
    expect(within(checkList()).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows veteran status once, not under Page 4 and Page 5 (the owner's report)", async () => {
    // A step finished twice (after a fix), from a server without the sheet.
    const pages = [
      page(4, "Voluntary Disclosures", [{ q: VET, a: "I don't wish to answer", guess: true }]),
      page(5, "Page 5", [{ q: VET, a: "I don't wish to answer", guess: true }]),
    ];
    show({ ...RUN, sheet: undefined, pages });
    await screen.findByRole("heading", { name: "Check these first" });
    expect(within(checkList()).getAllByRole("button")).toHaveLength(1);
    const groups = within(screen.getByRole("heading", { name: "Every answer" }).parentElement!).getAllByRole("button", {
      expanded: false,
    });
    expect(groups.map((g) => g.textContent)).toEqual(["Voluntary Disclosures1 filled · 1 to check"]);
    await userEvent.click(groups[0]);
    expect(screen.getAllByRole("button", { name: new RegExp(`^${VET}`) })).toHaveLength(2); // check first + its step
  });

  it("the same question asked on two steps is checked once", () => {
    const sheet = sheetFromPages([
      page(1, "Self Identify", [{ q: VET, a: "", guess: false }]),
      page(2, "Voluntary Disclosures", [{ q: "Veteran status?", a: "No" }, { q: "Race", a: "" }]),
      page(3, "Review", [{ q: VET, a: "" }]),
    ]);
    // Page 3 asks the Self Identify question again: the same step, once.
    expect(sheet.steps.map((s) => s.title)).toEqual(["Self Identify", "Voluntary Disclosures"]);
    expect(checkRows(sheet).map((c) => `${c.step.title}: ${c.row.q}`)).toEqual([
      `Self Identify: ${VET}`,
      "Voluntary Disclosures: Race",
    ]);
  });
});
