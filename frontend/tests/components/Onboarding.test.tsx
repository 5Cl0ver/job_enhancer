import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Welcome, Getting started and the ⓘ bubbles (spec 019 part B). Invented data.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

let phone = false;
vi.mock("@/hooks/useIsPhone", () => ({ useIsPhone: () => phone }));

import WelcomePage from "@/routes/WelcomePage";
import { GettingStarted } from "@/components/onboarding/GettingStarted";
import { READ_FAILED } from "@/components/onboarding/ResumeStep";
import { InfoBubble } from "@/components/common/InfoBubble";
import { HELP } from "@/lib/help";
import type { Onboarding } from "@/hooks/useOnboarding";

function state(over: Partial<Onboarding> = {}, done: string[] = []): Onboarding {
  const items = (["resume", "profile", "job_catcher", "first_job", "email", "claude"] as const).map((key, i) => ({
    key,
    done: done.includes(key),
    required: i < 4,
  }));
  return {
    welcome: { step: 0, done: false },
    checklist_hidden: false,
    items,
    required_done: items.filter((i) => i.required && i.done).length,
    required_total: 4,
    ...over,
  };
}

let onboarding: Onboarding;
let resumes: { id: string; filename: string; is_active: boolean }[];

function routes(path: string) {
  if (path === "/v1/onboarding") return Promise.resolve(onboarding);
  if (path === "/v1/ai/resumes") return Promise.resolve(resumes);
  if (path === "/v1/users/me/application-profile") return Promise.resolve({ first_name: null });
  if (path.endsWith("/details"))
    return Promise.resolve({ resume_id: "r1", filename: "wren.pdf", read: true, work: [{}, {}, {}], education: [{}], skills: [], certifications: [], websites: [] });
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

function wrap(ui: React.ReactElement, at = "/welcome") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/welcome" element={ui} />
          <Route path="/" element={<p>The app</p>} />
          <Route path="/search" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  phone = false;
  onboarding = state();
  resumes = [];
  get.mockReset().mockImplementation(routes);
  post.mockReset();
  put.mockReset().mockImplementation((_p: string, body: object) => Promise.resolve(body));
  patch.mockReset().mockImplementation((_p: string, body: Record<string, unknown>) => {
    if (typeof body.welcome_step === "number") onboarding.welcome.step = body.welcome_step;
    if (body.welcome_done !== undefined) onboarding.welcome.done = !!body.welcome_done;
    if (body.checklist_hidden !== undefined) onboarding.checklist_hidden = !!body.checklist_hidden;
    return Promise.resolve({ ...onboarding });
  });
});

describe("Welcome", () => {
  it("says hello, then shows four steps with dots", async () => {
    wrap(<WelcomePage />);
    await userEvent.click(await screen.findByRole("button", { name: /let's set you up/i }));
    expect(await screen.findByRole("heading", { name: "Your résumé" })).toBeInTheDocument();
    expect(screen.getByLabelText("Step 1 of 4")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith("/v1/onboarding", { welcome_step: 1 });
  });

  it("Skip finishes the Welcome and lands in the app", async () => {
    wrap(<WelcomePage />);
    await userEvent.click(await screen.findByRole("button", { name: /skip, do it later/i }));
    expect(patch).toHaveBeenCalledWith("/v1/onboarding", { welcome_done: true });
    expect(await screen.findByText("The app")).toBeInTheDocument();
  });

  it("reads the résumé, then Looks right saves the profile and marks it checked", async () => {
    resumes = [{ id: "r1", filename: "wren.pdf", is_active: true }];
    post.mockImplementation((path: string) =>
      path.endsWith("/from-resume")
        ? Promise.resolve({ profile: { first_name: "Wren", last_name: "Tester", phone: null, city: "Austin", state: "TX", linkedin_url: null }, filled: ["first_name"] })
        : Promise.resolve({ resume_id: "r1", filename: "wren.pdf", read: true, work: [{}, {}, {}], education: [{}], skills: [], certifications: [], websites: [] }),
    );
    wrap(<WelcomePage />, "/welcome?step=1");
    const first = await screen.findByLabelText("First name");
    expect(first).toHaveValue("Wren");
    expect(await screen.findByTestId("welcome-found")).toHaveTextContent("3 jobs and 1 school");
    await userEvent.clear(screen.getByLabelText("City"));
    await userEvent.type(screen.getByLabelText("City"), "Denver");
    await userEvent.click(screen.getByRole("button", { name: "Looks right" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/v1/users/me/application-profile",
        expect.objectContaining({ first_name: "Wren", city: "Denver" }),
      ),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/onboarding", { profile_reviewed: true, welcome_step: 2 }),
    );
    expect(await screen.findByRole("heading", { name: "Get Job Catcher" })).toBeInTheDocument();
  });

  it("when reading fails, says so and still shows the form", async () => {
    resumes = [{ id: "r1", filename: "wren.pdf", is_active: true }];
    post.mockRejectedValue(new Error("down"));
    wrap(<WelcomePage />, "/welcome?step=1");
    expect(await screen.findByText(READ_FAILED)).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("");
  });

  it("on a phone the Job Catcher step offers to send the link", async () => {
    phone = true;
    wrap(<WelcomePage />, "/welcome?step=2");
    expect(await screen.findByText(/runs in Chrome on a computer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /get job catcher/i })).not.toBeInTheDocument();
  });

  it("shows Connected when Job Catcher signs in", async () => {
    onboarding = state({}, ["job_catcher"]);
    wrap(<WelcomePage />, "/welcome?step=2");
    expect(await screen.findByText(/connected ✓/i)).toBeInTheDocument();
  });

  it("Back goes to the step before; the last step finishes it", async () => {
    wrap(<WelcomePage />, "/welcome?step=3");
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Get Job Catcher" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /i'll do it later/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "You're ready" })).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith("/v1/onboarding", { welcome_step: 4, welcome_done: true });
  });
});

describe("Getting started", () => {
  it("shows progress, the next item first, and optional items", async () => {
    onboarding = state({}, ["resume"]);
    wrap(<GettingStarted />, "/search");
    const card = await screen.findByTestId("getting-started");
    expect(within(card).getByText("1 of 4 done")).toBeInTheDocument();
    const next = within(card).getByRole("link", { name: "Check your profile" });
    expect(next).toHaveClass("font-medium");
    expect(next).toHaveAttribute("href", "/autofill#profile");
    expect(within(card).getAllByText("Optional")).toHaveLength(2);
    expect(within(card).getByRole("link", { name: "Add your résumé, done" })).toBeInTheDocument();
  });

  it("I'm all set hides it", async () => {
    wrap(<GettingStarted />, "/search");
    await userEvent.click(await screen.findByRole("button", { name: /getting started options/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /i'm all set/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/v1/onboarding", { checklist_hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument());
  });

  it("is gone once everything required is done, even with optional ones left", async () => {
    onboarding = state({}, ["resume", "profile", "job_catcher", "first_job"]);
    wrap(<GettingStarted />, "/search");
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
  });
});

describe("ⓘ bubbles", () => {
  it("opens on click with what, why and needs, and Esc closes it", async () => {
    wrap(<InfoBubble topic="jobCatcher" />, "/search");
    const button = screen.getByRole("button", { name: "About Job Catcher" });
    await userEvent.click(button);
    const bubble = await screen.findByRole("dialog");
    expect(bubble).toHaveTextContent(HELP.jobCatcher.what);
    expect(bubble).toHaveTextContent(HELP.jobCatcher.why);
    expect(bubble).toHaveTextContent("Phones can't run it");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("every bubble has what and why, in plain words", () => {
    for (const help of Object.values(HELP)) {
      expect(help.what.length).toBeGreaterThan(10);
      expect(help.why.length).toBeGreaterThan(10);
      const text = Object.values(help).join(" ");
      expect(text).not.toMatch(/\b(IMAP|MCP|OAuth|API|LLM)\b/);
    }
  });
});
