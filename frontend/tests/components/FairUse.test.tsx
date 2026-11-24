import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fair use and the owner's view (spec 019 part C). Invented data.
const get = vi.fn();
const put = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: (...a: unknown[]) => put(...a),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { readableError } from "@/lib/api";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { SearchResults } from "@/components/jobs/SearchResults";
import { UserTable } from "@/components/admin/UserTable";
import { AllowancesCard } from "@/components/admin/AllowancesCard";

function wrap(ui: React.ReactElement, at = "/search?q=analyst") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const usage = (over: object = {}) => ({
  exempt: false,
  resets_at: "2026-11-25T08:00:00Z",
  kinds: {
    ai_document: { used: 0, limit: 10, left: 10, on: false },
    ai_read: { used: 0, limit: 5, left: 5, on: false },
    ai_autofill: { used: 0, limit: 100, left: 100, on: false },
    live_search: { used: 1, limit: 5, left: 4, on: true },
  },
  shared: { jsearch_month: { used: 3, cap: 200, reserve: 40 } },
  ...over,
});

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe("what's left today", () => {
  it("shows live searches left, and nothing for AI while it's paused", async () => {
    get.mockResolvedValue(usage());
    wrap(
      <>
        <AllowanceNote kind="live_search" />
        <AllowanceNote kind="ai_document" />
      </>,
    );
    expect(await screen.findByText(/4 of 5 live searches left today/)).toBeInTheDocument();
    expect(screen.queryByTestId("allowance-ai_document")).not.toBeInTheDocument();
  });

  it("shows nothing for the owner", async () => {
    get.mockResolvedValue(usage({ exempt: true }));
    wrap(<AllowanceNote kind="live_search" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("allowance-live_search")).not.toBeInTheDocument();
  });

  it("an over-the-allowance error reads as its plain message", () => {
    const body = JSON.stringify({
      detail: { code: "ALLOWANCE", message: "You've used today's 10 free AI documents." },
    });
    expect(readableError(body)).toBe("You've used today's 10 free AI documents.");
    expect(readableError(JSON.stringify({ detail: "Not found" }))).toBe("Not found");
    expect(readableError(JSON.stringify({ error: "Rate limit exceeded: 5 per 1 minute" }))).toBe(
      "Rate limit exceeded: 5 per 1 minute",
    );
  });

  it("search says when the results aren't live", async () => {
    get.mockImplementation((path: string) =>
      path === "/v1/usage"
        ? Promise.resolve(usage())
        : Promise.resolve({
            results: [],
            meta: { page: 1, page_size: 20, total: 0, total_pages: 1 },
            live: false,
            note: "You've used today's 5 live searches, so these are jobs already in the app.",
          }),
    );
    wrap(<SearchResults searchParams={{ q: "analyst" }} />);
    expect(await screen.findByRole("status")).toHaveTextContent("jobs already in the app");
  });
});

describe("the owner's view", () => {
  it("lists setup, Job Catcher version, last active and today's use", async () => {
    get.mockImplementation((path: string) =>
      path.startsWith("/v1/admin/users")
        ? Promise.resolve([
            {
              id: "u1",
              email: "wren@example.com",
              name: "Wren",
              avatar_url: null,
              role: "user",
              follow_up_days: 7,
              created_at: "2026-11-01T10:00:00Z",
              last_active_at: "2026-11-23T10:00:00Z",
              onboarding: { welcome_done: true, resume: true, profile: false, job_catcher: true, first_job: false, email: false, claude: false },
              job_catcher: { version: "0.37.0", last_seen_at: "2026-11-23T10:00:00Z", outdated: true },
              usage_today: { live_search: 2 },
              usage_month: { live_search: 9 },
            },
          ])
        : Promise.resolve({ id: "admin", role: "admin" }),
    );
    wrap(<UserTable />, "/admin");
    const row = (await screen.findByText("wren@example.com")).closest("tr")!;
    expect(within(row).getByLabelText("Setup: Welcome, Résumé, Job Catcher")).toBeInTheDocument();
    expect(within(row).getByText("0.37.0 (old)")).toBeInTheDocument();
    expect(within(row).getByText("2 searches")).toBeInTheDocument();
    expect(within(row).getByText("Nov 23, 2026")).toBeInTheDocument();
  });

  it("saves new allowance numbers", async () => {
    const values = { ai_document: 10, ai_read: 5, ai_autofill: 100, live_search: 5, jsearch_month_cap: 200, jsearch_owner_reserve: 40, jsearch_person_month: 30 };
    get.mockResolvedValue(values);
    put.mockImplementation((_p: string, body: object) => Promise.resolve(body));
    wrap(<AllowancesCard />, "/admin");
    const box = await screen.findByLabelText("Live searches a day");
    await waitFor(() => expect(box).toHaveValue("5"));
    await userEvent.clear(box);
    await userEvent.type(box, "3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/v1/admin/allowances", { ...values, live_search: 3 }),
    );
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
  });

  it("won't save something that isn't a number", async () => {
    get.mockResolvedValue({ ai_document: 10, ai_read: 5, ai_autofill: 100, live_search: 5, jsearch_month_cap: 200, jsearch_owner_reserve: 40, jsearch_person_month: 30 });
    wrap(<AllowancesCard />, "/admin");
    const box = await screen.findByLabelText("Live searches a day");
    await waitFor(() => expect(box).toHaveValue("5"));
    await userEvent.clear(box);
    await userEvent.type(box, "lots");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
