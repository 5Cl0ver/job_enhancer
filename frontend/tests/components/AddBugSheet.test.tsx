// Spec 032: the owner's Add a bug or idea, from any page. The section is
// guessed from the page, the context is filled in and shown, saving keeps you
// on the page, and a failed save keeps what you typed. Part B: screenshots
// (shrunk, sent after the report; a failed one can be tried again) and
// "Looks like…" for a report that seems the same.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const upload = vi.fn();
const toastSuccess = vi.fn();
const shrink = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    upload: (...a: unknown[]) => upload(...a),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));
vi.mock("@/lib/shrinkImage", () => ({
  shrinkImage: (...a: unknown[]) => shrink(...a),
}));
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

import { AddBugButton } from "@/components/bugs/AddBugSheet";

function wrap(path: string, variant: "sidebar" | "icon" = "sidebar") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <AddBugButton variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue([
    {
      version: "0.43.0",
      browser: "Chrome",
      last_seen_at: "2026-11-20T10:00:00Z",
    },
    {
      version: "0.44.0",
      browser: "Chrome",
      last_seen_at: "2026-11-25T10:00:00Z",
    },
  ]);
  post.mockReset();
  upload.mockReset();
  toastSuccess.mockReset();
  shrink
    .mockReset()
    .mockImplementation(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

async function openAndType(path: string, title: string) {
  const user = userEvent.setup();
  wrap(path);
  await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
  const sheet = await screen.findByRole("dialog");
  await user.type(within(sheet).getByRole("textbox", { name: "Title" }), title);
  return { user, sheet };
}

const photo = () => new File(["png-bytes"], "shot.png", { type: "image/png" });

describe("Add a bug or idea", () => {
  it("guesses the section and fills in the page, device, browser, theme and Job Catcher", async () => {
    const user = userEvent.setup();
    wrap("/email-updates?tab=review");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Add a bug or idea",
    });
    expect(
      within(sheet).getByRole("combobox", { name: "Section" }),
    ).toHaveValue("email");
    const filled = within(sheet).getByRole("list", {
      name: "Filled in for you",
    });
    expect(filled).toHaveTextContent("/email-updates");
    expect(filled).not.toHaveTextContent("tab=review");
    expect(filled).toHaveTextContent("computer");
    expect(filled).toHaveTextContent("light");
    expect(
      await within(filled).findByText("Job Catcher 0.44.0"),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/v1/extension/installs");
  });

  it("saves a bug, says Added, and closes", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ report: { id: "r1" } });
    wrap("/jobs");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(
      within(sheet).getByRole("textbox", { name: "Title" }),
      "Save does nothing",
    );
    await user.type(
      within(sheet).getByRole("textbox", { name: "What happened" }),
      "Nothing moved",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "+ Add steps" }),
    );
    await user.type(
      within(sheet).getByRole("textbox", { name: /Steps/ }),
      "1. Open a job{Enter}2. Press Save",
    );
    await user.click(within(sheet).getByRole("radio", { name: "Blocker" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe("/v1/admin/bugs");
    expect(body).toMatchObject({
      type: "bug",
      title: "Save does nothing",
      section: "app",
      severity: "blocker",
      actual: "Nothing moved",
      steps: ["Open a job", "Press Save"],
      place: "/jobs",
      context: { device: "computer", theme: "light", job_catcher: "0.44.0" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Added");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("an idea has no severity and no expected", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ report: { id: "r2" } });
    wrap("/search?tab=scout", "icon");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("radio", { name: "Idea" }));
    expect(
      within(sheet).queryByRole("radiogroup", { name: "Severity" }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("textbox", { name: "What you expected" }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).getByRole("combobox", { name: "Section" }),
    ).toHaveValue("scout");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Title" }),
      "Run Scout every morning",
    );
    await user.type(
      within(sheet).getByRole("textbox", { name: "The idea" }),
      "On a schedule",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.type).toBe("idea");
    expect(body).not.toHaveProperty("severity");
    expect(body.actual).toBe("On a schedule");
  });

  it("keeps what was typed when saving fails", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error("offline"));
    wrap("/jobs");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Title" }),
      "Lost my words",
    );
    await user.click(within(sheet).getByRole("combobox", { name: "Section" }));
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Section" }),
      "scout",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Couldn't save, try again.",
    );
    expect(within(sheet).getByRole("textbox", { name: "Title" })).toHaveValue(
      "Lost my words",
    );
    expect(
      within(sheet).getByRole("combobox", { name: "Section" }),
    ).toHaveValue("scout");
    expect(toastSuccess).not.toHaveBeenCalled();

    // Closed and opened again, it's still there.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    expect(
      within(await screen.findByRole("dialog")).getByRole("textbox", {
        name: "Title",
      }),
    ).toHaveValue("Lost my words");
  });
  it("says when a step is too long or there are too many, before saving", async () => {
    const user = userEvent.setup();
    wrap("/jobs");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Title" }),
      "Long steps",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "+ Add steps" }),
    );
    const steps = within(sheet).getByRole("textbox", { name: /Steps/ });
    expect(
      within(sheet).getByText("Up to 12 steps, 300 characters each."),
    ).toBeInTheDocument();
    await user.click(steps);
    await user.paste("x".repeat(301));
    expect(
      within(sheet).getByText(
        "Step 1 is over 300 characters. Make it shorter or split it.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(steps);
    await user.paste(
      Array.from({ length: 13 }, (_, i) => `Step ${i + 1}`).join(
        String.fromCharCode(10),
      ),
    );
    expect(
      within(sheet).getByText("Only the first 12 steps are kept."),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows the server's reason when it refuses the text", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue({
      status: 422,
      message: JSON.stringify({
        detail: [
          {
            loc: ["body", "title"],
            msg: "String should have at most 140 characters",
          },
        ],
      }),
    });
    wrap("/jobs");
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(
      within(sheet).getByRole("textbox", { name: "Title" }),
      "Too long",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Title: String should have at most 140 characters.",
    );
  });
});

describe("Screenshots", () => {
  it("adds one, shows it, and sends it after the report is saved", async () => {
    post.mockResolvedValue({ report: { id: "r1" }, similar: [] });
    upload.mockResolvedValue({ id: "s1", size: 4 });
    const { user, sheet } = await openAndType("/jobs", "Save does nothing");
    await user.upload(
      within(sheet).getByLabelText("Add a screenshot"),
      photo(),
    );
    expect(
      await within(sheet).findByRole("img", { name: "Screenshot 1" }),
    ).toHaveAttribute("src", "blob:preview");
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(within(sheet).getByLabelText("Add another")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const [path, file] = upload.mock.calls[0];
    expect(path).toBe("/v1/admin/bugs/r1/shots");
    expect((file as Blob).type).toBe("image/jpeg");
    expect(post.mock.calls[0][1].context.app_version).toBe("dev");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Added"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("can be removed before saving, and stops at 3", async () => {
    const { user, sheet } = await openAndType("/jobs", "Three pictures");
    for (const n of [1, 2, 3]) {
      await user.upload(
        within(sheet).getByLabelText(
          n > 1 ? "Add another" : "Add a screenshot",
        ),
        photo(),
      );
      await within(sheet).findByRole("img", { name: "Screenshot " + n });
    }
    expect(
      within(sheet).queryByLabelText("Add another"),
    ).not.toBeInTheDocument();
    await user.click(
      within(sheet).getByRole("button", { name: "Remove screenshot 2" }),
    );
    expect(within(sheet).getAllByRole("img")).toHaveLength(2);
    expect(within(sheet).getByLabelText("Add another")).toBeInTheDocument();
  });

  it("says when a picture can't be used", async () => {
    shrink.mockResolvedValue(null);
    const { user, sheet } = await openAndType("/jobs", "Odd picture");
    await user.upload(
      within(sheet).getByLabelText("Add a screenshot"),
      photo(),
    );
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "That picture couldn't be used. Try a JPEG or PNG.",
    );
    expect(within(sheet).queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the report when the picture fails, and tries again", async () => {
    post.mockResolvedValue({ report: { id: "r1" }, similar: [] });
    upload
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "s1", size: 4 });
    const { user, sheet } = await openAndType("/jobs", "Picture fails");
    await user.upload(
      within(sheet).getByLabelText("Add a screenshot"),
      photo(),
    );
    await within(sheet).findByRole("img", { name: "Screenshot 1" });
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Added" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Added, but the picture didn't upload.",
    );
    expect(post).toHaveBeenCalledTimes(1); // the report isn't sent again
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1][0]).toBe("/v1/admin/bugs/r1/shots");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Added"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

describe("Looks like", () => {
  const similar = [
    {
      id: "old1",
      title: "Phone put in Phone Extension",
      status: "confirmed",
      score: 90,
    },
  ];

  it("offers a report that seems the same; Same problem merges them", async () => {
    post.mockImplementation(async (path: string) =>
      path === "/v1/admin/bugs"
        ? { report: { id: "new1" }, similar }
        : { id: "old1" },
    );
    const { user, sheet } = await openAndType(
      "/apply/run1",
      "Phone in extension box",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Added" });
    expect(within(dialog).getByText("Looks like")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Phone put in Phone Extension"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Confirmed")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Same problem as Phone put in Phone Extension",
      }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/admin/bugs/new1/merge", {
        into_id: "old1",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Added to the one you had");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("It's new keeps it as its own report", async () => {
    post.mockResolvedValue({ report: { id: "new1" }, similar });
    const { user, sheet } = await openAndType(
      "/jobs",
      "Phone in extension box",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Added" });
    await user.click(within(dialog).getByRole("button", { name: "It's new" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(post).toHaveBeenCalledTimes(1);
    // Opened again, it's a fresh form.
    await user.click(screen.getByRole("button", { name: "Add a bug or idea" }));
    expect(
      within(
        await screen.findByRole("dialog", { name: "Add a bug or idea" }),
      ).getByRole("textbox", { name: "Title" }),
    ).toHaveValue("");
  });

  it("says when the merge fails", async () => {
    post.mockImplementation(async (path: string) => {
      if (path === "/v1/admin/bugs") return { report: { id: "new1" }, similar };
      throw new Error("offline");
    });
    const { user, sheet } = await openAndType(
      "/jobs",
      "Phone in extension box",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Added" });
    await user.click(
      within(dialog).getByRole("button", { name: /Same problem/ }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't merge them. Try again.",
    );
  });
});
