import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn().mockResolvedValue(new Blob(["x"])),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ApplyButton, openWatched, webUrl } from "@/components/jobs/ApplyButton";
import { NowLine, stuckOn } from "@/components/apply/NowLine";
import { ResumeReview } from "@/components/apply/ResumeReview";
import { useApplyRun, useContinue } from "@/hooks/useApply";
import { ago } from "@/lib/ago";
import { fixLine, fixNotMade, type ApplyRun, type RunFix } from "@/lib/apply";
import { outdatedJobCatcher } from "@/lib/jobCatcher";
import type { JobListing } from "@/types/api";

const wrap = (ui: React.ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const RUN: ApplyRun = {
  id: "r1",
  status: "filling",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Northwind Labs", location: "" },
  apply_url: "https://northwind.example/apply",
  created_at: "2026-11-28T10:00:00Z",
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
  events: [{ at: new Date(Date.now() - 40_000).toISOString(), kind: "fill", text: "Claude asked Job Catcher to fill page 1." }],
  started_at: null,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("what Claude is doing now (spec 040)", () => {
  it("says the last step and how long ago, while it's Claude's turn", () => {
    wrap(<NowLine run={RUN} />);
    expect(screen.getByText(/Last step: Claude asked Job Catcher to fill page 1\./)).toHaveTextContent("40 s ago");
    expect(screen.queryByText(/ran into a problem/)).not.toBeInTheDocument();
  });

  it("says what Claude ran into since its last step", () => {
    const later = new Date().toISOString();
    const run = {
      ...RUN,
      problems: [{ id: "p1", at: later, kind: "site" as const, what: "The phone number won't take.", page: null, count: 1 }],
    };
    expect(stuckOn(run)).toBe("The phone number won't take.");
    wrap(<NowLine run={run} />);
    expect(screen.getByRole("status")).toHaveTextContent("Claude ran into a problem: The phone number won't take.");
  });

  it("takes the newest problem by its time, not its place in the list", () => {
    const t = (s: number) => new Date(Date.now() + s * 1000).toISOString();
    const run = {
      ...RUN,
      problems: [
        { id: "p2", at: t(9), kind: "site" as const, what: "Newest.", page: null, count: 1 },
        { id: "p1", at: t(3), kind: "site" as const, what: "Older.", page: null, count: 1 },
      ],
    };
    expect(stuckOn(run)).toBe("Newest.");
  });

  it("is quiet while the run waits for you", () => {
    const { container } = wrap(<NowLine run={{ ...RUN, paused_step: "my information" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts seconds, then minutes", () => {
    const now = Date.parse("2026-11-28T10:05:00Z");
    expect(ago("2026-11-28T10:04:20Z", now)).toBe("40 s ago");
    expect(ago("2026-11-28T10:02:00Z", now)).toBe("3 min ago");
  });
});

describe("Continue shows Sent to Claude at once (spec 040)", () => {
  function Probe() {
    const go = useContinue();
    return (
      <button type="button" onClick={() => go.mutate("r1")}>
        go
      </button>
    );
  }

  it("the step's look is over before the server answers, and comes back on an error", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["apply-run", "r1"], { ...RUN, paused_step: "my information", paused_title: "My Information" });
    let fail: (e: Error) => void = () => {};
    post.mockReturnValue(new Promise((_r, rej) => (fail = rej)));
    wrap(<Probe />, qc);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(qc.getQueryData<ApplyRun>(["apply-run", "r1"])?.paused_step).toBeNull());
    const check = qc.getQueryData<ApplyRun>(["apply-run", "r1"])?.sheet?.check;
    expect(check).toMatchObject({ step: "my information", title: "My Information", read: false });
    await act(async () => fail(new Error("offline")));
    await waitFor(() => expect(qc.getQueryData<ApplyRun>(["apply-run", "r1"])?.paused_step).toBe("my information"));
  });
});

describe("a poll during Continue never brings the step back (spec 040)", () => {
  function Both() {
    const { data } = useApplyRun("r1");
    const go = useContinue();
    return (
      <>
        <p>{data?.paused_step ?? "going on"}</p>
        <button type="button" onClick={() => go.mutate("r1")}>
          go
        </button>
      </>
    );
  }

  it("keeps Sent to Claude while the Continue is on its way", async () => {
    const paused = { ...RUN, paused_step: "my information", paused_title: "My Information" };
    get.mockResolvedValue(paused); // every poll still says paused
    post.mockReturnValue(new Promise(() => {})); // the Continue never lands
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrap(<Both />, qc);
    expect(await screen.findByText("my information")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByText("going on")).toBeInTheDocument();
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["apply-run", "r1"] });
    });
    expect(screen.getByText("going on")).toBeInTheDocument();
  });
});

describe("a fix the page didn't show (spec 040)", () => {
  const fix: RunFix = { id: "f1", step: "s", q: "Prefix", k: 1, now: "Mr.", to: "Dr.", status: "sent", at: "" };
  it("says Claude is looking again, and lets you do it yourself", () => {
    expect(fixLine({ ...fix, doubted: "t" })).toBe("→ Dr. (not on the page yet: Claude is looking again)");
    expect(fixLine({ ...fix, doubted: "t", claude_done: "t" })).toBe("→ Dr. (Claude says done; the page didn't show it)");
    expect(fixNotMade({ ...fix, doubted: "t" })).toBe(true);
    expect(fixNotMade({ ...fix, claude_done: "t" })).toBe(false);
  });
});

describe("a cover letter with the résumé (spec 040)", () => {
  const run: ApplyRun = {
    ...RUN,
    status: "resume_review",
    resume_id: "made",
    document_id: "d1",
    resume_check: { round: 1, decision: null, note: null, at: null },
  };
  beforeEach(() => {
    get.mockImplementation((path: string) => {
      if (path === "/v1/users/me") return Promise.resolve({ id: "u", email: "sam@example.com", review_resumes: true });
      return Promise.resolve([]);
    });
    post.mockResolvedValue(run);
  });

  it("Use it can ask for a cover letter too", async () => {
    wrap(<ResumeReview run={run} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Also write a cover letter for this job" }));
    await userEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/apply/runs/r1/resume-decision", { decision: "use", note: null, cover_letter: true }),
    );
  });

  it("not offered when the job already has a letter", () => {
    wrap(<ResumeReview run={{ ...run, cover_letter: { id: "c1", filename: "Letter.pdf" } }} />);
    expect(screen.queryByRole("checkbox", { name: /cover letter/ })).not.toBeInTheDocument();
  });
});

describe("Did you apply? only once you're done (spec 040)", () => {
  const JOB = { id: "l1", title: "IT Engineer", company: "Northwind Labs", apply_url: "https://jobs.example/1" } as JobListing;
  let tab: { opener: unknown; location: { href: string }; closed: boolean; close: () => void };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tab = { opener: "app", location: { href: "" }, closed: false, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/v1/pipeline") || path.includes("stages") ? [{ id: "st-applied", name: "Applied" }] : []),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never on coming back to the app; asks when the application's tab closes", async () => {
    wrap(<ApplyButton job={JOB} />);
    await userEvent.click(screen.getByRole("link", { name: /Apply Now/ }));
    expect(tab.opener).toBeNull(); // the new tab can't reach back
    expect(tab.location.href).toBe("https://jobs.example/1");
    // Back on the app's tab mid-application: nothing asked.
    window.dispatchEvent(new Event("focus"));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Did you apply?")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(6000));
    tab.closed = true;
    await act(async () => vi.advanceTimersByTime(2000));
    expect(await screen.findByText("Did you apply?")).toBeInTheDocument();
  });

  it("a site that cuts the tab off at once (COOP) is never asked about", async () => {
    wrap(<ApplyButton job={JOB} />);
    await userEvent.click(screen.getByRole("link", { name: /Apply Now/ }));
    tab.closed = true; // reads closed right away while it's really open
    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.queryByText("Did you apply?")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "I applied" })).toBeInTheDocument();
  });

  it("no quiet I applied where Applied is one tap away", async () => {
    wrap(<ApplyButton job={JOB} showApplied={false} />);
    await userEvent.click(screen.getByRole("link", { name: /Apply Now/ }));
    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole("button", { name: "I applied" })).not.toBeInTheDocument();
  });
});

describe("Apply Now opens only web addresses (spec 040)", () => {
  it("never a javascript: or data: link", () => {
    const open = vi.spyOn(window, "open");
    expect(webUrl("javascript:alert(1)")).toBeNull();
    expect(webUrl("data:text/html,x")).toBeNull();
    expect(webUrl("https://jobs.example/1")).toBe("https://jobs.example/1");
    expect(openWatched("javascript:alert(1)")).toBeNull();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("follows the link from the new tab with no referrer", () => {
    const doc = document.implementation.createHTMLDocument("");
    const clicked: { href: string; rel: string }[] = [];
    const tab = { opener: "app", document: doc, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const realCreate = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      el.click = () => clicked.push({ href: el.href, rel: el.rel });
      return el;
    });
    expect(openWatched("https://jobs.example/1")).toBe(tab);
    expect(tab.opener).toBeNull();
    expect(clicked).toEqual([{ href: "https://jobs.example/1", rel: "noreferrer" }]);
    vi.restoreAllMocks();
  });
});

describe("which Job Catcher is behind (spec 040)", () => {
  it("doesn't name the browser when there's only one computer", () => {
    const now = Date.parse("2026-11-28T12:00:00Z");
    expect(
      outdatedJobCatcher(
        [
          { install_id: "a", version: "0.48.0", browser: "Chrome 157 (Windows)", last_seen_at: new Date(now - 3600_000).toISOString() },
          { install_id: "b", version: "0.44.0", browser: "Chrome 157 (Windows)", last_seen_at: new Date(now - 7200_000).toISOString() },
        ],
        "0.49.0",
        now,
      ),
    ).toEqual({ version: "0.48.0", latest: "0.49.0", where: "" });
  });

  const now = Date.parse("2026-11-28T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3600_000).toISOString();

  it("an old copy that didn't name its system is replaced by a current one seen after it", () => {
    expect(
      outdatedJobCatcher(
        [
          { install_id: "new", version: "0.49.0", browser: "Chrome 157 (Windows)", last_seen_at: at(1) },
          { install_id: "old", version: "0.48.0", browser: "Chrome 157 (Windows)", last_seen_at: at(15) },
          { install_id: "older", version: "0.44.0", browser: "Chrome 157", last_seen_at: at(52) },
        ],
        "0.49.0",
        now,
      ),
    ).toBeNull();
  });

  it("the Job Catcher in this browser counts as seen now", () => {
    const old = [{ install_id: "a", version: "0.44.0", browser: "Chrome 157 (Windows)", last_seen_at: at(2) }];
    expect(outdatedJobCatcher(old, "0.49.0", now, { version: "0.49.0", browser: "Chrome 157 (Windows)" })).toBeNull();
    expect(outdatedJobCatcher([], "0.49.0", now, { version: "0.48.0", browser: "Chrome 157 (Windows)" })).toEqual({
      version: "0.48.0",
      latest: "0.49.0",
      where: "",
    });
    // Another computer that's behind is still named.
    const mac = [{ install_id: "m", version: "0.44.0", browser: "Chrome 157 (macOS)", last_seen_at: at(2) }];
    expect(outdatedJobCatcher(mac, "0.49.0", now, { version: "0.49.0", browser: "Chrome 157 (Windows)" })).toEqual({
      version: "0.44.0",
      latest: "0.49.0",
      where: "Chrome (macOS)",
    });
  });
});
