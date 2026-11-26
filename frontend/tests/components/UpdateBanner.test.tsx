import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), delete: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { Readiness } from "@/components/apply/Remote";
import { outdatedJobCatcher } from "@/lib/jobCatcher";
import type { ApplyRun } from "@/lib/apply";

const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
const RELEASE = { version: "0.45.0", notes: "", published_at: null, sha256: null, download_url: "https://example.test/jc.zip" };

function setup(installs: unknown[], latest = RELEASE, path = "/saved") {
  get.mockImplementation((p: string) => Promise.resolve(p.endsWith("/latest") ? latest : installs));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <UpdateBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
});

describe("the app's Job Catcher update banner (spec 034)", () => {
  it("an out-of-date Job Catcher: on every page, with How to update", async () => {
    setup([{ version: "0.42.0", browser: "Chrome 142", last_seen_at: now() }]);
    const banner = await screen.findByTestId("jc-update-banner");
    expect(banner).toHaveTextContent(
      "Job Catcher on your computer is out of date (0.42.0 → 0.45.0). Update it so the latest fixes work.",
    );
    expect(screen.getByRole("link", { name: "How to update" })).toHaveAttribute("href", "/job-catcher#update");
  });

  it("the newest version: no banner", async () => {
    setup([{ version: "0.45.0", browser: "Chrome 142", last_seen_at: now() }]);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("jc-update-banner")).not.toBeInTheDocument();
  });

  it("Hide for a day hides it, and keeps it hidden on the next page load", async () => {
    const { unmount } = setup([{ version: "0.42.0", browser: "Chrome 142", last_seen_at: now() }]);
    await userEvent.click(await screen.findByRole("button", { name: /Hide for a day/ }));
    expect(screen.queryByTestId("jc-update-banner")).not.toBeInTheDocument();
    unmount();
    setup([{ version: "0.42.0", browser: "Chrome 142", last_seen_at: now() }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("jc-update-banner")).not.toBeInTheDocument();
    // A newer release shows it again.
    setup([{ version: "0.42.0", browser: "Chrome 142", last_seen_at: now() }], { ...RELEASE, version: "0.46.0" });
    expect(await screen.findByTestId("jc-update-banner")).toHaveTextContent("0.42.0 → 0.46.0");
  });

  it("not on the Job Catcher page itself", async () => {
    setup([{ version: "0.42.0", browser: "Chrome 142", last_seen_at: now() }], RELEASE, "/job-catcher");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("jc-update-banner")).not.toBeInTheDocument();
  });
});

describe("which Job Catcher is behind", () => {
  it("names the browser when there's more than one", () => {
    expect(
      outdatedJobCatcher(
        [
          { version: "0.45.0", browser: "Edge 142", last_seen_at: now() },
          { version: "0.42.0", browser: "Chrome 141", last_seen_at: daysAgo(2) },
        ],
        "0.45.0",
      ),
    ).toEqual({ version: "0.42.0", latest: "0.45.0", where: "Chrome" });
  });

  it("ignores one not seen for 30 days, one replaced by an up-to-date copy, and an unknown release", () => {
    expect(outdatedJobCatcher([{ version: "0.42.0", browser: "Chrome 141", last_seen_at: daysAgo(40) }], "0.45.0")).toBeNull();
    expect(
      outdatedJobCatcher(
        [
          { version: "0.45.0", browser: "Chrome 142", last_seen_at: now() },
          { version: "0.42.0", browser: "Chrome 141", last_seen_at: daysAgo(1) },
        ],
        "0.45.0",
      ),
    ).toBeNull();
    expect(outdatedJobCatcher([{ version: "0.42.0", browser: "Chrome 141", last_seen_at: now() }], null)).toBeNull();
  });
});

describe("Apply with Claude's ready check (spec 034)", () => {
  const run = (jc: Record<string, unknown>) => ({ job_catcher: jc }) as unknown as ApplyRun;
  const show = (jc: Record<string, unknown>) =>
    render(
      <MemoryRouter>
        <Readiness run={run(jc)} open />
      </MemoryRouter>,
    );

  it("calls an out-of-date Job Catcher out by name, before anything else", () => {
    show({ version: "0.42.0", latest: "0.45.0", outdated: true, ready: true, new_enough: true, needs: "0.41.0" });
    expect(screen.getByTestId("jc-outdated")).toHaveTextContent("Job Catcher 0.42.0 is out of date: update before you start.");
  });

  it("a current one that's quiet: hasn't checked in lately", () => {
    show({ version: "0.45.0", latest: "0.45.0", outdated: false, ready: false, new_enough: true, needs: "0.41.0" });
    expect(screen.getByText(/hasn't checked in/)).toBeInTheDocument();
    expect(screen.queryByTestId("jc-outdated")).not.toBeInTheDocument();
  });
});
