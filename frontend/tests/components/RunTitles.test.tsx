import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: (...args: unknown[]) => patch(...args),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { RunTitles } from "@/components/scout/RunTitles";
import { type Run, withTitle } from "@/lib/scout";

const MISSION = {
  id: "m1",
  name: "LinkedIn · Anything I'd be good at · 5 · last 3 days",
  broad: true,
  overrides: { always: [], never: ["Desktop Support"], avoid: [] },
};
const TRACK = {
  id: "t1",
  name: "IT Admin",
  target_titles: ["IT Systems Administrator"],
};
const RUN = {
  id: "r1",
  mission_id: "m1",
  broad: true,
  titles: [
    { title: "Microsoft 365 Administrator", good_fits: 2 },
    { title: "Desktop Support", good_fits: 0 },
  ],
} as unknown as Run;

function renderTitles(run: Run = RUN) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <RunTitles run={run} />
    </QueryClientProvider>,
  );
}

describe("What Claude searched for", () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/scout/missions"
          ? [MISSION]
          : path === "/v1/scout/tracks"
            ? [TRACK]
            : [],
      ),
    );
    patch.mockResolvedValue({});
  });

  it("lists each title with its good fits", async () => {
    renderTitles();
    expect(await screen.findByText("Microsoft 365 Administrator")).toBeInTheDocument();
    expect(screen.getByText("2 good fits")).toBeInTheDocument();
    expect(screen.getByText("0 good fits")).toBeInTheDocument();
    // Already blocked: its Never button is done.
    expect(
      await screen.findByRole("button", { name: "Never search Desktop Support" }),
    ).toBeDisabled();
  });

  it("Always pins a title and takes it off Never", async () => {
    const user = userEvent.setup();
    renderTitles();
    await user.click(
      await screen.findByRole("button", { name: "Always search Desktop Support" }),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/missions/m1", {
        overrides: { always: ["Desktop Support"], never: [], avoid: [] },
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "“Desktop Support” is searched on every run.",
    );
  });

  it("adds a title to a resume type", async () => {
    const user = userEvent.setup();
    renderTitles();
    await user.click(
      await screen.findByRole("combobox", {
        name: "Add Microsoft 365 Administrator to a resume type",
      }),
    );
    await user.click(await screen.findByRole("option", { name: "IT Admin" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", {
        target_titles: ["IT Systems Administrator", "Microsoft 365 Administrator"],
      }),
    );
  });

  it("shows nothing for a search with a resume type", () => {
    const { container } = renderTitles({ ...RUN, broad: false } as Run);
    expect(container).toBeEmptyDOMElement();
  });

  it("withTitle moves a title between the lists without repeats", () => {
    const o = { always: ["A"], never: ["b"], avoid: ["x"] };
    expect(withTitle(o, "never", "a")).toEqual({ always: [], never: ["b", "a"], avoid: ["x"] });
    expect(withTitle(o, "never", "B")).toEqual(o);
    expect(withTitle(null, "always", "C")).toEqual({ always: ["C"], never: [], avoid: [] });
  });
});
