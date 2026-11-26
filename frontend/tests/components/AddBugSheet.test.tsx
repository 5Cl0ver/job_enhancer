// Spec 032: the owner's Add a bug or idea, from any page. The section is
// guessed from the page, the context is filled in and shown, saving keeps you
// on the page, and a failed save keeps what you typed.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
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
  toastSuccess.mockReset();
});

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
});
