// Spec 032: a report's screenshots. Each picture is fetched once with the
// sign-in and kept apart from the inbox data, so refreshing the inbox (any
// change to any report) never downloads the pictures again; deleting one
// forgets it.
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlob = vi.fn();
const get = vi.fn();
const del = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
    getBlob: (...a: unknown[]) => getBlob(...a),
  },
}));

import { BugShots } from "@/components/bugs/BugShots";

let made = 0;

beforeEach(() => {
  made = 0;
  getBlob
    .mockReset()
    .mockImplementation(async () => new Blob(["png"], { type: "image/png" }));
  del.mockReset().mockResolvedValue(null);
  get.mockReset().mockResolvedValue({ shots: TWO });
  URL.createObjectURL = vi.fn(() => `blob:${++made}`);
  URL.revokeObjectURL = vi.fn();
});

const TWO = [
  { id: "s1", size: 100 },
  { id: "s2", size: 200 },
];

/** The report's detail, as the inbox has it, with its screenshots. */
function Detail() {
  const { data } = useQuery({
    queryKey: ["admin", "bugs", "detail", "r1"],
    queryFn: () => get("/v1/admin/bugs/r1"),
  });
  return data ? <BugShots shots={data.shots} /> : null;
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <Detail />
    </QueryClientProvider>,
  );
  return { qc, view };
}

describe("BugShots", () => {
  it("shows each picture, fetched once with the sign-in", async () => {
    setup();
    expect(
      await screen.findByRole("button", { name: "View screenshot 1" }),
    ).toBeInTheDocument();
    await screen.findByRole("button", { name: "View screenshot 2" });
    expect(getBlob.mock.calls.map((c) => c[0])).toEqual([
      "/v1/admin/bugs/shots/s1",
      "/v1/admin/bugs/shots/s2",
    ]);
  });

  it("doesn't download the pictures again when the inbox refreshes", async () => {
    const { qc } = setup();
    await screen.findByRole("button", { name: "View screenshot 2" });
    await qc.invalidateQueries({ queryKey: ["admin", "bugs"] });
    expect(getBlob).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("frees each picture's URL when it goes", async () => {
    const { view } = setup();
    await screen.findByRole("button", { name: "View screenshot 2" });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
  });

  it("deletes one after a confirm, and its picture isn't fetched again", async () => {
    const user = userEvent.setup();
    const { qc } = setup();
    await screen.findByRole("button", { name: "View screenshot 1" });
    get.mockResolvedValue({ shots: [TWO[1]] });
    await user.click(
      screen.getByRole("button", { name: "Delete screenshot 1" }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/v1/admin/bugs/shots/s1"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "View screenshot 2" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "View screenshot 1" }),
    ).toBeInTheDocument();
    expect(qc.getQueryData(["bug-shot", "s2"])).toBeDefined();
    expect(getBlob).toHaveBeenCalledTimes(2); // never fetched again
  });
});
