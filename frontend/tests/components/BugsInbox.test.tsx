// Spec 032 part A: Bugs & ideas. Tabs and section chips with counts, the
// filter sheet, the detail as a side panel (computer) or a sheet (phone),
// statuses, notes, delete, select many, and Copy for Claude.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BugDetail, BugList, BugRow } from "@/lib/bugs";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

import AdminBugsPage from "@/routes/AdminBugsPage";

const BASE: BugRow = {
  id: "b1",
  type: "bug",
  title: "Blocker seen five times",
  section: "job_catcher",
  severity: "blocker",
  status: "new",
  source: "run",
  count: 5,
  first_seen: "2026-11-20T10:00:00Z",
  last_seen: "2026-11-25T10:00:00Z",
  came_back_at: null,
  needs_check: false,
  fixed_in: null,
  pinned: false,
  place: "acme.example/apply/:id",
  has_shot: false,
  kind: "resume",
  box: null,
  steps: [],
  actual: "Said no résumé box",
  expected: "",
  confidence: "sure",
  context: { job_catcher: "0.44.0" },
  run_id: "run-1",
};
const ROWS: BugRow[] = [
  BASE,
  {
    ...BASE,
    id: "b2",
    title: "Minor seen once",
    severity: "minor",
    count: 1,
    source: "owner",
    section: "email",
    came_back_at: "2026-11-25T09:00:00Z",
  },
];
const LIST: BugList = {
  items: ROWS,
  total: 2,
  counts: {
    bugs_open: 2,
    ideas_open: 1,
    sections: {
      app: 0,
      job_catcher: 1,
      email: 1,
      scout: 0,
      apply: 0,
      other: 0,
    },
  },
};
const DETAIL: BugDetail = {
  ...BASE,
  steps: ["Open the job", "Press Apply"],
  expected: "It attaches",
  run: { id: "run-1", own: true },
  job: {
    id: "job-1",
    title: "IT Engineer",
    company: "Northwind Labs",
    own: true,
  },
  links: [],
  shots: [],
  events: [
    {
      id: "e2",
      kind: "note",
      by: "owner",
      at: "2026-11-25T11:00:00Z",
      data: { text: "Only on Workday" },
    },
    {
      id: "e1",
      kind: "status",
      by: "owner",
      at: "2026-11-25T10:30:00Z",
      data: { from: "new", to: "confirmed" },
    },
  ],
};

function respond(admin = true) {
  get.mockImplementation((path: string) => {
    if (path === "/v1/users/me")
      return Promise.resolve({ id: "u1", role: admin ? "admin" : "user" });
    if (path.startsWith("/v1/admin/bugs?")) return Promise.resolve(LIST);
    if (path.startsWith("/v1/admin/bugs/")) return Promise.resolve(DETAIL);
    return Promise.resolve([]);
  });
}

function wrap(path = "/admin/bugs") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/bugs" element={<AdminBugsPage />} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let writeText: ReturnType<typeof vi.fn>;
const realMatchMedia = window.matchMedia;

function asPhone() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width: 767px"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  toastSuccess.mockReset();
  respond();
});

/** userEvent.setup() puts in its own clipboard; this one goes in after it. */
function stubClipboard() {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

const listCalls = () =>
  get.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.startsWith("/v1/admin/bugs?"));

describe("Bugs & ideas", () => {
  it("shows the tabs and sections with counts, and the reports in order", async () => {
    wrap();
    const list = await screen.findByRole("list", { name: "Bugs" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Blocker seen five times"),
      expect.stringContaining("Minor seen once"),
    ]);
    expect(rows[0]).toHaveTextContent("×5");
    expect(rows[0]).toHaveTextContent("Claude in a run");
    expect(rows[1]).toHaveTextContent("Came back");
    expect(screen.getByRole("radio", { name: "Bugs 2" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Ideas 1" })).toBeInTheDocument();
    const sections = screen.getByRole("group", { name: "Sections" });
    expect(
      within(sections).getByRole("button", { name: /Job Catcher 1/ }),
    ).toBeInTheDocument();
    expect(listCalls()[0]).toBe(
      "/v1/admin/bugs?type=bug&status=open&limit=100&offset=0",
    );
  });

  it("filters by section, by the filter sheet, and switches to ideas", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByRole("list", { name: "Bugs" });
    await user.click(screen.getByRole("button", { name: /Job Catcher 1/ }));
    await waitFor(() =>
      expect(listCalls().at(-1)).toContain("section=job_catcher"),
    );

    await user.click(screen.getByRole("button", { name: "Filter" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Blocker" }));
    await user.click(within(sheet).getByRole("switch", { name: "Came back" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(listCalls().at(-1)).toContain("severity=blocker"),
    );
    expect(listCalls().at(-1)).toContain("came_back=true");
    expect(screen.getByRole("button", { name: "Filter" })).toHaveTextContent(
      "2",
    );

    await user.click(screen.getByRole("radio", { name: /Ideas/ }));
    await waitFor(() =>
      expect(listCalls().at(-1)).toBe(
        "/v1/admin/bugs?type=idea&status=open&limit=100&offset=0",
      ),
    );
  });

  it("opens a report in the side panel, with everything on it", async () => {
    const user = userEvent.setup();
    wrap();
    const list = await screen.findByRole("list", { name: "Bugs" });
    await user.click(within(list).getByText("Blocker seen five times"));
    const panel = await screen.findByRole("complementary", { name: "Report" });
    const report = await within(panel).findByRole("article");
    expect(within(report).getByText("Said no résumé box")).toBeInTheDocument();
    expect(within(report).getByText("It attaches")).toBeInTheDocument();
    expect(within(report).getByText("Press Apply")).toBeInTheDocument();
    expect(within(report).getByText("Only on Workday")).toBeInTheDocument();
    expect(within(report).getByText("New → Confirmed")).toBeInTheDocument();
    expect(
      within(report).getByRole("link", {
        name: "IT Engineer at Northwind Labs",
      }),
    ).toHaveAttribute("href", "/jobs/job-1");
    expect(
      within(report).getByRole("link", { name: "The run" }),
    ).toHaveAttribute("href", "/apply/run-1");
    expect(get).toHaveBeenCalledWith("/v1/admin/bugs/b1");
  });

  it("marks one fixed, asking which version", async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ ...DETAIL, status: "fixed", fixed_in: "PR #70" });
    wrap("/admin/bugs?id=b1");
    const report = await screen.findByRole("article");
    await user.selectOptions(
      within(report).getByRole("combobox", { name: "Status" }),
      "fixed",
    );
    await user.type(
      within(report).getByRole("textbox", { name: "Fixed in which version?" }),
      "PR #70",
    );
    await user.click(
      within(report).getByRole("button", { name: "Mark fixed" }),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/admin/bugs/b1", {
        status: "fixed",
        fixed_in: "PR #70",
      }),
    );
    // Other statuses go straight away.
    await user.selectOptions(
      within(report).getByRole("combobox", { name: "Status" }),
      "wont_fix",
    );
    await waitFor(() =>
      expect(patch).toHaveBeenLastCalledWith("/v1/admin/bugs/b1", {
        status: "wont_fix",
      }),
    );
  });

  it("adds a note and deletes after a confirm", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      id: "e9",
      kind: "note",
      by: "owner",
      at: "2026-11-25T12:00:00Z",
      data: { text: "x" },
    });
    del.mockResolvedValue(null);
    wrap("/admin/bugs?id=b1");
    const report = await screen.findByRole("article");
    await user.type(
      within(report).getByRole("textbox", { name: "Add a note" }),
      "Seen on a phone too",
    );
    await user.click(within(report).getByRole("button", { name: "Add note" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/admin/bugs/b1/notes", {
        text: "Seen on a phone too",
      }),
    );

    await user.click(within(report).getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Delete for good?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/v1/admin/bugs/b1"));
  });

  it("copies the whole filtered list for Claude, numbered", async () => {
    const user = userEvent.setup();
    stubClipboard();
    wrap();
    await screen.findByRole("list", { name: "Bugs" });
    await user.click(screen.getByRole("button", { name: "Copy 2 for Claude" }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text.startsWith("# 2 bugs from Bugs & ideas")).toBe(true);
    expect(text).toContain(
      "## 1. Bug in Job Catcher, blocker\n\n```text\nBlocker seen five times\n```",
    );
    expect(text).toContain("## 2. Bug in Email updates, minor");
    expect(text).toContain("```text\nSaid no résumé box\n```");
    expect(toastSuccess).toHaveBeenCalledWith("Copied 2");
  });

  it("pages with Show more, and says when a copy is only the first page", async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path === "/v1/users/me")
        return Promise.resolve({ id: "u1", role: "admin" });
      if (path.startsWith("/v1/admin/bugs?")) {
        const offset = new URLSearchParams(path.split("?")[1]).get("offset");
        const page = offset === "0" ? [ROWS[0]] : [ROWS[1]];
        return Promise.resolve({ ...LIST, items: page, total: 2 });
      }
      return Promise.resolve([]);
    });
    wrap();
    const list = await screen.findByRole("list", { name: "Bugs" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Copy first 1 for Claude" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Show more (1 left)" }),
    );
    await waitFor(() =>
      expect(within(list).getAllByRole("button")).toHaveLength(2),
    );
    expect(listCalls().at(-1)).toContain("offset=1");
    expect(
      screen.getByRole("button", { name: "Copy 2 for Claude" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show more/ }),
    ).not.toBeInTheDocument();
  });

  it("names someone else's job and run without linking to them", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/v1/users/me")
        return Promise.resolve({ id: "u1", role: "admin" });
      if (path.startsWith("/v1/admin/bugs?")) return Promise.resolve(LIST);
      return Promise.resolve({
        ...DETAIL,
        run: { id: "run-9", own: false },
        job: {
          id: "job-9",
          title: "IT Engineer",
          company: "Northwind Labs",
          own: false,
        },
      });
    });
    wrap("/admin/bugs?id=b1");
    const report = await screen.findByRole("article");
    expect(
      within(report).getByText(
        "IT Engineer at Northwind Labs (someone else's job)",
      ),
    ).toBeInTheDocument();
    expect(within(report).getByText("Someone else's run")).toBeInTheDocument();
    expect(within(report).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows your AI's reports and Claude's fix waiting for your check (part C)", async () => {
    const user = userEvent.setup();
    const fixed: BugDetail = {
      ...DETAIL,
      source: "owner_ai",
      status: "fixed",
      fixed_in: "PR #71",
      needs_check: true,
      events: [
        {
          id: "e3",
          kind: "note",
          by: "claude",
          at: "2026-11-26T09:00:00Z",
          data: { text: "Skipped extension boxes." },
        },
        {
          id: "e4",
          kind: "status",
          by: "claude",
          at: "2026-11-26T09:00:00Z",
          data: { from: "new", to: "fixed", fixed_in: "PR #71" },
        },
      ],
    };
    get.mockImplementation((path: string) => {
      if (path === "/v1/users/me")
        return Promise.resolve({ id: "u1", role: "admin" });
      if (path.startsWith("/v1/admin/bugs?"))
        return Promise.resolve({
          ...LIST,
          items: [{ ...BASE, source: "owner_ai", needs_check: true }],
          total: 1,
        });
      return Promise.resolve(fixed);
    });
    patch.mockResolvedValue({ ...fixed, needs_check: false });
    wrap("/admin/bugs?id=b1");
    const list = await screen.findByRole("list", { name: "Bugs" });
    const row = within(list).getByRole("button");
    expect(row).toHaveTextContent("Your AI");
    expect(row).toHaveTextContent("Needs your check");
    const report = await screen.findByRole("article");
    expect(
      within(report).getByText("Fixed by Claude: needs your check"),
    ).toBeInTheDocument();
    expect(within(report).getByText("Your AI")).toBeInTheDocument();
    expect(
      within(report).getByText("Skipped extension boxes."),
    ).toBeInTheDocument();
    await user.click(within(report).getByRole("button", { name: "Looks fixed" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/admin/bugs/b1", {
        checked: true,
      }),
    );
  });

  it("says so when a change, a merge or a link doesn't save", async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(new Error("offline"));
    post.mockRejectedValue(new Error("That report is gone or already merged."));
    wrap("/admin/bugs?id=b1");
    const report = await screen.findByRole("article");
    await user.click(within(report).getByRole("button", { name: "Pin" }));
    expect(await within(report).findByRole("alert")).toHaveTextContent(
      "Couldn't save, try again.",
    );

    await user.click(within(report).getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Same as another…" }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "Same as another report",
    });
    await user.click(await within(picker).findByText("Minor seen once"));
    expect(await within(picker).findByRole("alert")).toHaveTextContent(
      "That report is gone or already merged.",
    );
    await user.keyboard("{Escape}");

    await user.click(within(report).getByRole("button", { name: "Link one" }));
    const linker = await screen.findByRole("dialog", { name: "Link a report" });
    await user.click(await within(linker).findByText("Minor seen once"));
    expect(
      await within(report).findByText("Couldn't link them. Try again."),
    ).toBeInTheDocument();
  });

  it("selects several to change their status or copy them", async () => {
    const user = userEvent.setup();
    stubClipboard();
    post.mockResolvedValue({ changed: 2 });
    wrap();
    const list = await screen.findByRole("list", { name: "Bugs" });
    await user.click(screen.getByRole("button", { name: "Select" }));
    for (const title of ["Blocker seen five times", "Minor seen once"]) {
      await user.click(within(list).getByText(title));
    }
    const bar = screen.getByRole("region", { name: "Selected reports" });
    expect(bar).toHaveTextContent("2 selected");
    await user.click(
      within(bar).getByRole("button", { name: "Copy 2 for Claude" }),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).toContain(
      "## 2. Bug in Email updates, minor\n\n```text\nMinor seen once\n```",
    );
    await user.selectOptions(
      within(bar).getByRole("combobox", { name: "Set status" }),
      "wont_fix",
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/admin/bugs/bulk", {
        ids: ["b1", "b2"],
        status: "wont_fix",
      }),
    );
    // Changed: the selection is cleared (the rows may have left the list).
    await waitFor(() => expect(bar).toHaveTextContent("0 selected"));
    // Selecting doesn't open a report.
    expect(get).not.toHaveBeenCalledWith("/v1/admin/bugs/b1");
  });

  it("on a phone, the report opens as a sheet", async () => {
    asPhone();
    const user = userEvent.setup();
    wrap();
    const list = await screen.findByRole("list", { name: "Bugs" });
    expect(
      screen.queryByRole("complementary", { name: "Report" }),
    ).not.toBeInTheDocument();
    await user.click(within(list).getByText("Blocker seen five times"));
    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Only on Workday"),
    ).toBeInTheDocument();
  });

  it("sends anyone else away", async () => {
    respond(false);
    wrap();
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(listCalls()).toEqual([]);
  });
});
