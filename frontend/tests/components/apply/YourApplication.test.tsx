// Spec 033: Your application (one growing list by step), the fix sheet with
// the form's real choices, the waiting tray, the step check, the two modes.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRun } from "./fakeRun";

let server: ReturnType<typeof fakeRun>;

vi.mock("@/lib/api", () => ({
  api: {
    get: (path: string) => server.get(path),
    post: (path: string, body?: Record<string, unknown>) => server.post(path, body),
    patch: (path: string, body?: Record<string, unknown>) => server.patch(path, body),
    put: vi.fn(),
    delete: (path: string) => server.delete(path),
    getBlob: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ModeSwitch } from "@/components/apply/ModeSwitch";
import { StepCheck } from "@/components/apply/StepCheck";
import { YourApplication } from "@/components/apply/YourApplication";
import { useApplyRun } from "@/hooks/useApply";
import type { ApplyRun, Sheet } from "@/lib/apply";

const VET = "Please select your veteran status";
const VET_CHOICES = [
  "I am a protected veteran",
  "I am not a protected veteran",
  "I identify as one or more of the classifications of protected veteran",
  "I don't wish to answer",
];

const SHEET: Sheet = {
  current: "application questions",
  steps: [
    {
      key: "my information",
      title: "My Information",
      n: 1,
      done: true,
      rows: [
        { q: "First Name", a: "Sam", by: "job_catcher", tag: "profile" },
        { q: "Last Name", a: "Rivera", by: "job_catcher", tag: "profile" },
        { q: "Prefix", a: "Mr.", guess: true, tag: "guess", options: ["Mr.", "Ms.", "Dr."] },
      ],
    },
    {
      key: "my experience",
      title: "My Experience",
      n: 2,
      done: true,
      rows: [
        { q: "Job Title", a: "IT Engineer", tag: null },
        { q: "Job Title", a: "Help Desk", tag: null },
      ],
    },
    {
      key: "application questions",
      title: "Application Questions",
      n: 3,
      done: false,
      rows: [
        { q: VET, a: "I don't wish to answer", guess: true, tag: "guess", options: VET_CHOICES },
        { q: "Why Acme?", a: "", tag: "empty" },
        {
          q: "Country",
          a: "",
          tag: "empty",
          options: Array.from({ length: 12 }, (_, i) => (i === 7 ? "Portugal" : `Country ${i}`)),
        },
        { q: "City", a: "Portland", tag: null, options: ["Portland", "Salem"], free: true },
      ],
    },
  ],
};

const RUN: ApplyRun = {
  id: "r1",
  status: "filling",
  mode: "keep",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Acme", location: "" },
  apply_url: "https://acme.example/apply",
  created_at: "2026-11-25T10:00:00Z",
  finished_at: null,
  questions_open: 0,
  help: null,
  review: null,
  note: null,
  questions: [],
  answers_done: true,
  pages: [],
  resume_id: "res1",
  document_id: null,
  events: [],
  started_at: null,
  sheet: SHEET,
  fixes: [],
};

/** The page as the owner sees it: the run read from the (fake) server. */
function Live({ part }: { part: "list" | "check" | "mode" }) {
  const { data } = useApplyRun("r1");
  if (!data) return null;
  if (part === "check") return <StepCheck run={data} />;
  if (part === "mode") return <ModeSwitch run={data} explain />;
  return <YourApplication run={data} />;
}

function show(run: ApplyRun, part: "list" | "check" | "mode" = "list") {
  server = fakeRun(run);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Live part={part} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const list = () => screen.getByRole("region", { name: "Your application" });

describe("Your application (spec 033)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is one growing list, grouped by step, with clear counts", async () => {
    show(RUN);
    await screen.findByRole("region", { name: "Your application" });
    expect(within(list()).getByText("Filling Application Questions · 7 filled · 4 to check")).toBeInTheDocument();
    // The step being filled is open; finished ones fold to one line.
    const info = within(list()).getByRole("button", { name: /^My Information/ });
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(within(info).getByText("3 filled · 1 to check")).toBeInTheDocument();
    expect(within(list()).getByRole("list", { name: "Application Questions" })).toBeInTheDocument();
    expect(within(list()).getByText("Now")).toBeInTheDocument();
    // A tap opens a finished step: every box once, with its tag.
    await userEvent.click(info);
    const step = within(list()).getByRole("list", { name: "My Information" });
    expect(within(step).getAllByText("From your profile")).toHaveLength(2);
    expect(within(step).getByText("Claude guessed")).toBeInTheDocument();
    // The same question twice on a step stays two rows.
    await userEvent.click(within(list()).getByRole("button", { name: /^My Experience/ }));
    expect(within(list()).getAllByRole("button", { name: /^Job Title:/ })).toHaveLength(2);
  });

  it("shows the form's real choices, and a change waits", async () => {
    show(RUN);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${VET}:`) }));
    const sheet = screen.getByRole("dialog");
    const choices = within(sheet).getAllByRole("radio");
    expect(choices.map((c) => c.textContent)).toEqual([
      VET_CHOICES[0],
      VET_CHOICES[1],
      VET_CHOICES[2],
      `${VET_CHOICES[3]}Now`,
    ]);
    // Choices, not a text box (the form doesn't take typing here).
    expect(within(sheet).queryByRole("textbox", { name: "Change it to" })).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Something else")).not.toBeInTheDocument();
    expect(within(sheet).getByText("It waits, and goes to Claude when it finishes the last step.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Add fix" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("radio", { name: /not a protected/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add fix" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.method === "POST")).toEqual({
      method: "POST",
      path: "/v1/apply/runs/r1/fixes",
      body: { step: "application questions", q: VET, k: 1, to: VET_CHOICES[1], ask: null },
    });
    expect(await within(list()).findByText(`→ ${VET_CHOICES[1]} (waiting)`)).toBeInTheDocument();
    expect(within(list()).getByText("Filling Application Questions · 7 filled · 4 to check · 1 fix waiting")).toBeInTheDocument();
    expect(within(list()).getByRole("button", { name: "1 fix waiting" })).toBeInTheDocument();
  });

  it("long lists get a search box; a text box only when the form takes typing", async () => {
    show(RUN);
    await userEvent.click(await screen.findByRole("button", { name: /^Country:/ }));
    let sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Search the choices"), "port");
    expect(within(sheet).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Portugal"]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: /^City:/ }));
    sheet = screen.getByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Something else" }));
    await userEvent.type(within(sheet).getByLabelText("Change it to"), "Eugene");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add fix" }));
    await waitFor(() => expect(server.now().fixes?.[0]?.to).toBe("Eugene"));
    await userEvent.click(within(list()).getByRole("button", { name: /^Why Acme\?/ }));
    sheet = screen.getByRole("dialog");
    // No choices at all: just a text box.
    expect(within(sheet).queryAllByRole("radio")).toHaveLength(0);
    expect(within(sheet).getByLabelText("Change it to")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: /Ask Claude about it/ }));
    await userEvent.type(within(sheet).getByLabelText("Ask Claude about it"), "Should this mention Okta?");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add fix" }));
    await waitFor(() => expect(server.now().fixes).toHaveLength(2));
    expect(server.now().fixes?.[1]).toMatchObject({ q: "Why Acme?", ask: "Should this mention Okta?", to: null });
  });

  it("the tray: every waiting fix, edit or remove one, Send now", async () => {
    show({
      ...RUN,
      fixes: [
        { id: "a", step: "my information", q: "Prefix", k: 1, now: "Mr.", to: "Dr.", status: "waiting", at: "" },
        { id: "b", step: "application questions", q: "Why Acme?", k: 1, now: "", ask: "Okta?", status: "waiting", at: "" },
        { id: "c", step: "my experience", q: "Job Title", k: 2, now: "Help Desk", to: "Lead", status: "done", at: "" },
      ],
    });
    const tray = await screen.findByRole("button", { name: "2 fixes waiting" });
    await userEvent.click(tray);
    expect(screen.getByText("My Information · Prefix")).toBeInTheDocument();
    expect(screen.getByText("Ask: Okta?")).toBeInTheDocument();
    // Edit one: the sheet opens on its box, with its choices.
    await userEvent.click(screen.getByRole("button", { name: "Edit the fix for Prefix" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("radio", { name: "Dr." })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Ms." }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Update fix" }));
    await waitFor(() => expect(server.now().fixes?.[0].to).toBe("Ms."));
    await userEvent.click(screen.getByRole("button", { name: "Remove the fix for Why Acme?" }));
    await waitFor(() => expect(server.now().fixes).toHaveLength(2));
    // Done fixes show on their row.
    await userEvent.click(within(list()).getByRole("button", { name: /^My Experience/ }));
    expect(within(list()).getByText("→ Lead (done)")).toBeInTheDocument();
    // Send now asks first.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/v1/apply/runs/r1/fixes/send")).toBe(true));
  });

  it("a fix that couldn't apply says so", async () => {
    show({
      ...RUN,
      fixes: [{ id: "g", step: "application questions", q: "Why Acme?", k: 1, now: "", to: "x", status: "gone", at: "" }],
    });
    expect(await screen.findByText("Couldn't apply: box gone")).toBeInTheDocument();
  });

  it("asks for a newer Job Catcher when nothing can be read", async () => {
    show({
      ...RUN,
      sheet: { steps: [] },
      job_catcher: { version: "0.41.0", last_seen_at: null, ready: true, new_enough: true, live: false, needs: "0.41.0" },
    });
    expect(await screen.findByText("Update Job Catcher to watch the boxes fill here.")).toBeInTheDocument();
  });
});

describe("Page by page: the step check (spec 033)", () => {
  it("shows the step's boxes and one big Continue that sends its fixes", async () => {
    show({ ...RUN, mode: "page", paused_step: "my information", paused_title: "My Information" }, "check");
    expect(await screen.findByRole("heading", { name: "My Information is done: look it over" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks good, continue" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Prefix:/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("It goes to Claude when you press Continue.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Ms." }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add fix" }));
    const go = await screen.findByRole("button", { name: "Continue with 1 fix" });
    await userEvent.click(go);
    await waitFor(() => expect(server.calls.some((c) => c.path === "/v1/apply/runs/r1/continue")).toBe(true));
    expect(server.now().fixes?.[0].status).toBe("sent");
    await waitFor(() => expect(screen.queryByRole("heading", { name: /look it over/ })).not.toBeInTheDocument());
    // Spec 038: it says whether Claude got it.
    expect(screen.getByRole("status")).toHaveTextContent("Sent to Claude…");
  });
});

describe("after Continue: did it reach Claude? (spec 038)", () => {
  const check = (extra: Partial<NonNullable<Sheet["check"]>>) => ({
    ...RUN,
    mode: "page" as const,
    sheet: {
      ...SHEET,
      check: { step: "my information", title: "My Information", at: new Date().toISOString(), read: false, ...extra },
    },
  });

  it("sent, until Claude gets it", async () => {
    show(check({}), "check");
    expect(await screen.findByRole("status")).toHaveTextContent("Sent to Claude…");
  });

  it("Claude got it", async () => {
    show(check({ read: true, read_at: new Date().toISOString() }), "check");
    expect(await screen.findByRole("status")).toHaveTextContent("Claude got it.");
  });

  it("not picked up after 2 minutes: what to tell Claude", async () => {
    show(check({ at: new Date(Date.now() - 3 * 60_000).toISOString() }), "check");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Claude hasn't picked this up. In the chat, tell it: carry on",
    );
  });

  it("gone once Claude fills the next step", async () => {
    show(check({ read: true, moved_on: true }), "check");
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("fixes Claude couldn't make (spec 038)", () => {
  const declined = {
    ...RUN,
    fixes: [
      {
        id: "f1",
        step: "my information",
        q: "Prefix",
        k: 1,
        now: "Mr.",
        to: "Dr.",
        status: "declined" as const,
        why: "The form only offers Mr. or Ms.",
        at: "",
      },
    ],
  };

  it("says why, and I did it myself tells Claude", async () => {
    show(declined);
    await screen.findByRole("region", { name: "Your application" });
    await userEvent.click(within(list()).getByRole("button", { name: /^My Information/ }));
    expect(within(list()).getByText("Claude didn't do this: The form only offers Mr. or Ms.")).toBeInTheDocument();
    await userEvent.click(within(list()).getByRole("button", { name: /^Prefix:/ }));
    const sheet = screen.getByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "I did it myself" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/v1/apply/runs/r1/fixes/f1/did-it")).toBe(true);
    expect(await within(list()).findByText("→ Dr. (you did it)")).toBeInTheDocument();
  });

  it("a tick box says Claude only ticks optional boxes when asked", async () => {
    const consent = {
      ...RUN,
      sheet: {
        ...SHEET,
        steps: [
          ...SHEET.steps.slice(0, 2),
          { ...SHEET.steps[2], rows: [...SHEET.steps[2].rows, { q: "Send me texts about this job", a: "No", tag: null }] },
        ],
      },
    };
    show(consent);
    await userEvent.click(await screen.findByRole("button", { name: /^Send me texts about this job:/ }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Claude never ticks optional boxes (texts, marketing) by itself. Ask here and it will.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: /^City:/ }));
    expect(within(screen.getByRole("dialog")).queryByText(/never ticks optional boxes/)).not.toBeInTheDocument();
  });
});

describe("the two modes (spec 033)", () => {
  it("Page by page is the default; switch any time", async () => {
    show({ ...RUN, status: "waiting", mode: undefined }, "mode");
    const page = await screen.findByRole("radio", { name: "Page by page" });
    expect(page).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Claude stops after each step/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Keep going" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Keep going" })).toHaveAttribute("aria-checked", "true"));
    expect(server.calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      path: "/v1/apply/runs/r1/mode",
      body: { mode: "keep" },
    });
    expect(screen.getByText(/you check it all at the end/)).toBeInTheDocument();
  });
});
