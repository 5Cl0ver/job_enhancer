import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const session = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
    patch: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => session(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({}),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
    },
  }),
}));

let phone = false;
vi.mock("@/hooks/useIsPhone", () => ({ useIsPhone: () => phone }));

import ConnectPage, { NOT_HERE } from "@/routes/ConnectPage";
import JobCatcherPage from "@/routes/JobCatcherPage";
import ForgotPasswordPage, { RESET_SENT } from "@/routes/ForgotPasswordPage";
import ResetPasswordPage, { DISCONNECTED, NOT_DISCONNECTED } from "@/routes/ResetPasswordPage";
import { isOlder } from "@/lib/jobCatcher";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Job Catcher in "this Chrome": answers with the proof for its own code. */
function jobCatcherHere(answer: (msg: { code: string }) => unknown) {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (_id: string, msg: { code: string }, cb: (r: unknown) => void) => cb(answer(msg)),
    },
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset().mockResolvedValue(undefined);
  session.mockReset().mockResolvedValue({ data: { session: { user: { email: "wren@example.com" } } } });
  phone = false;
  window.history.replaceState({}, "", "/connect?code=K7QM-3XPD");
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("Connect Job Catcher page", () => {
  it("names the account and the code, and approves with Job Catcher's proof", async () => {
    jobCatcherHere((m) => (m.code === "K7QM-3XPD" ? { proof: "p".repeat(43) } : {}));
    post.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/status") ? { status: "pending", expires_in: 200 } : { status: "approved" }),
    );
    wrap(<ConnectPage />);
    expect(await screen.findByText("wren@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Code K7QM-3XPD")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(post).toHaveBeenCalledWith("/v1/extension/connect/approve", {
      code: "K7QM-3XPD",
      proof: "p".repeat(43),
    });
    expect(await screen.findByText("Connected.")).toBeInTheDocument();
  });

  it("never approves when there's no Job Catcher here (a link someone sent)", async () => {
    post.mockResolvedValue({ status: "pending", expires_in: 200 });
    wrap(<ConnectPage />);
    expect(await screen.findByText(NOT_HERE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith("/v1/extension/connect/approve", expect.anything());
  });

  it("a Job Catcher that didn't start this code gives no proof", async () => {
    jobCatcherHere(() => ({}));
    post.mockResolvedValue({ status: "pending", expires_in: 200 });
    wrap(<ConnectPage />);
    expect(await screen.findByText(NOT_HERE)).toBeInTheDocument();
  });

  it("says when the link expired", async () => {
    jobCatcherHere(() => ({ proof: "p".repeat(43) }));
    post.mockRejectedValue(new Error("expired"));
    wrap(<ConnectPage />);
    expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
  });

  it("signed out: sign in first, then back here", async () => {
    session.mockResolvedValue({ data: { session: null } });
    wrap(<ConnectPage />);
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", `/login?redirect=${encodeURIComponent("/connect?code=K7QM-3XPD")}`);
  });
});

describe("Get Job Catcher page", () => {
  const RELEASE = {
    version: "0.35.0",
    notes: "Connect with one press",
    published_at: null,
    sha256: "ab".repeat(32),
    download_url: "https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip",
  };

  const now = () => new Date().toISOString();
  function api(connections: unknown[], installs: unknown[] = []) {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/latest") ? RELEASE : path.endsWith("/installs") ? installs : connections,
      ),
    );
  }

  it("not installed yet: download and the six steps", async () => {
    api([]);
    wrap(<JobCatcherPage />);
    expect(await screen.findByText("Not installed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download Job Catcher/ })).toHaveAttribute(
      "href",
      RELEASE.download_url,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(await screen.findByText(/Latest version 0.35.0/)).toBeInTheDocument();
    expect(screen.getByText(RELEASE.sha256)).toBeInTheDocument();
  });

  it("tells everyone about the one-time reconnect in 0.35.0", async () => {
    api([]);
    wrap(<JobCatcherPage />);
    expect(await screen.findByText(/remove the old Job Catcher first/)).toBeInTheDocument();
  });

  it("a password sign-in (no pass) still shows as connected, from its hello", async () => {
    api([], [{ version: "0.35.0", browser: "Edge 142", last_seen_at: now() }]);
    wrap(<JobCatcherPage />);
    expect(await screen.findByText(/Connected \(0.35.0\)/)).toBeInTheDocument();
  });

  it("connected and current, then outdated with a way to disconnect", async () => {
    api(
      [{ id: "t1", browser: "Chrome 142", version: "0.35.0", created_at: "2026-11-23", last_used_at: null }],
      [{ version: "0.35.0", browser: "Chrome 142", last_seen_at: now() }],
    );
    const { unmount } = wrap(<JobCatcherPage />);
    expect(await screen.findByText(/Connected \(0.35.0\)/)).toBeInTheDocument();
    unmount();

    api(
      [{ id: "t1", browser: "Chrome 142", version: "0.34.1", created_at: "2026-11-23", last_used_at: null }],
      [{ version: "0.34.1", browser: "Chrome 142", last_seen_at: now() }],
    );
    wrap(<JobCatcherPage />);
    expect(await screen.findByText(/Update available: you have 0.34.1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect Chrome 142" }));
    expect(del).toHaveBeenCalledWith("/v1/extension/tokens/t1");
  });

  it("on a phone: share or copy the link instead of the steps", async () => {
    phone = true;
    api([]);
    wrap(<JobCatcherPage />);
    expect(await screen.findByText(/runs in Chrome on a computer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download Job Catcher/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Install in 6 steps")).not.toBeInTheDocument();
  });

  it("compares versions as numbers", () => {
    expect(isOlder("0.9.0", "0.10.0")).toBe(true);
    expect(isOlder("0.35.0", "0.35.0")).toBe(false);
    expect(isOlder(null, "0.35.0")).toBe(false);
  });
});

describe("Forgot and reset password", () => {
  it("always the same neutral message", async () => {
    resetPasswordForEmail.mockRejectedValueOnce(new Error("no such user"));
    wrap(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(RESET_SENT)).toBeInTheDocument();
  });

  it("needs 8 characters and the same password twice", async () => {
    updateUser.mockResolvedValue({ error: null });
    wrap(<ResetPasswordPage />);
    const first = await screen.findByLabelText("New password");
    await userEvent.type(first, "short");
    await userEvent.type(screen.getByLabelText("New password again"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(/at least 8/)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();

    await userEvent.clear(first);
    await userEvent.type(first, "a-long-password");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(/don't match/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("New password again"));
    await userEvent.type(screen.getByLabelText("New password again"), "a-long-password");
    post.mockResolvedValue({ revoked: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "a-long-password" }));
    // Every Job Catcher is signed out too, and the page says so.
    expect(await screen.findByText(DISCONNECTED)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/v1/extension/tokens/revoke-all", {});
  });

  it("never claims Job Catcher was disconnected when that failed", async () => {
    updateUser.mockResolvedValue({ error: null });
    post.mockRejectedValue(new Error("waking up"));
    wrap(<ResetPasswordPage retryMs={[0, 0]} />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-long-password");
    await userEvent.type(screen.getByLabelText("New password again"), "a-long-password");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(NOT_DISCONNECTED)).toBeInTheDocument();
    expect(screen.queryByText(DISCONNECTED)).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(3); // tried again while the server woke
  });

  it("a second try that works still counts", async () => {
    updateUser.mockResolvedValue({ error: null });
    post.mockRejectedValueOnce(new Error("waking up")).mockResolvedValue({ revoked: 1 });
    wrap(<ResetPasswordPage retryMs={[0, 0]} />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-long-password");
    await userEvent.type(screen.getByLabelText("New password again"), "a-long-password");
    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(DISCONNECTED)).toBeInTheDocument();
  });
});
