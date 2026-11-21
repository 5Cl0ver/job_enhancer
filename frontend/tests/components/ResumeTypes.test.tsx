import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ResumeTypes } from "@/components/scout/ResumeTypes";
import { STARTER_TRACKS } from "@/lib/scout";

const TRACK = {
  id: "t1",
  name: "IT Admin",
  target_titles: ["IT Systems Administrator", "Jira Administrator"],
  key_skills: ["Microsoft 365"],
  skip_rules: { degree_only: true, max_years: null, exclude: [] },
  min_pay: 70000,
  resume_id: null,
  resume_filename: null,
  notes: null,
  sort_order: 0,
  job_count: 2,
  created_at: "2026-11-18T00:00:00Z",
  updated_at: "2026-11-18T00:00:00Z",
};

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function serve(tracks: unknown[]) {
  get.mockImplementation((path: string) =>
    Promise.resolve(path === "/v1/scout/tracks" ? tracks : []),
  );
}

describe("Resume types", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  it("starts a first-time user with the five suggested types", async () => {
    serve([]);
    post.mockResolvedValue(TRACK);
    const user = userEvent.setup();
    renderWithQuery(<ResumeTypes />);

    await user.click(await screen.findByRole("button", { name: /add the five suggested/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(STARTER_TRACKS.length));
    expect(post.mock.calls.map((c) => c[1].name)).toEqual(STARTER_TRACKS.map((t) => t.name));
  });

  it("shows each type's titles, pay, saved jobs and a missing resume", async () => {
    serve([TRACK]);
    renderWithQuery(<ResumeTypes />);
    expect(await screen.findByText("IT Admin")).toBeInTheDocument();
    expect(screen.getByText("Jira Administrator")).toBeInTheDocument();
    expect(screen.getByText(/2 saved jobs · \$70K\+/)).toBeInTheDocument();
    // No resume yet: the card itself offers the upload.
    expect(
      screen.getByRole("button", { name: "Upload the resume for this type" }),
    ).toBeInTheDocument();
  });

  it("flags a type with no skills listed", async () => {
    serve([TRACK, { ...TRACK, id: "t2", name: "Help Desk", key_skills: [] }]);
    renderWithQuery(<ResumeTypes />);
    expect(await screen.findByText("Help Desk")).toBeInTheDocument();
    // Only the type without skills says so.
    expect(screen.getAllByText(/No skills listed/)).toHaveLength(1);
  });

  it("uploads a resume from the card, attaches it and fills in the skills", async () => {
    const user = userEvent.setup();
    const blank = { ...TRACK, key_skills: [] };
    get.mockImplementation((path: string) => {
      if (path === "/v1/scout/tracks") return Promise.resolve([blank]);
      if (path === "/v1/ai/resumes/r9/skills")
        return Promise.resolve({ skills: ["Microsoft 365", "PowerShell"] });
      return Promise.resolve([]);
    });
    post.mockResolvedValue({ id: "r9", filename: "it-admin.pdf" });
    patch.mockResolvedValue({});
    renderWithQuery(<ResumeTypes />);

    const file = new File(["%PDF"], "it-admin.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText("Resume file for IT Admin"), file);

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", {
        resume_id: "r9",
        key_skills: ["Microsoft 365", "PowerShell"],
      }),
    );
    expect(post.mock.calls[0][0]).toBe("/v1/ai/resumes?make_active=false");
  });

  it("keeps the skills a type already has when a resume is attached", async () => {
    const user = userEvent.setup();
    serve([TRACK]); // has "Microsoft 365" already
    post.mockResolvedValue({ id: "r9", filename: "it-admin.pdf" });
    patch.mockResolvedValue({});
    renderWithQuery(<ResumeTypes />);

    const file = new File(["%PDF"], "it-admin.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText("Resume file for IT Admin"), file);

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", { resume_id: "r9" }),
    );
  });

  it("in the editor, skills follow the chosen resume until the user writes their own", async () => {
    const user = userEvent.setup();
    const RESUMES = [
      { id: "ra", filename: "admin.pdf", is_active: false, created_at: "2026-11-01T10:00:00Z" },
      { id: "rb", filename: "analyst.pdf", is_active: false, created_at: "2026-11-02T10:00:00Z" },
    ];
    get.mockImplementation((path: string) => {
      if (path === "/v1/scout/tracks") return Promise.resolve([{ ...TRACK, key_skills: [] }]);
      if (path === "/v1/ai/resumes") return Promise.resolve(RESUMES);
      if (path === "/v1/ai/resumes/ra/skills")
        return Promise.resolve({ skills: ["PowerShell", "Intune"] });
      if (path === "/v1/ai/resumes/rb/skills")
        return Promise.resolve({ skills: ["Power BI", "Visio"] });
      return Promise.resolve([]);
    });
    renderWithQuery(<ResumeTypes />);
    await user.click(await screen.findByRole("button", { name: /edit/i }));
    const box = await screen.findByLabelText("Your key skills for this kind of role");
    const pick = async (name: string) => {
      await user.click(screen.getByRole("combobox", { name: "Resume to apply with" }));
      await user.click(await screen.findByRole("option", { name }));
    };

    await pick("admin.pdf");
    await waitFor(() => expect(box).toHaveValue("PowerShell, Intune"));
    // Another resume: its skills replace the ones the app filled in.
    await pick("analyst.pdf");
    await waitFor(() => expect(box).toHaveValue("Power BI, Visio"));
    // Once the user edits the box, choosing a resume leaves it alone.
    await user.type(box, ", Excel");
    await pick("admin.pdf");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/ai/resumes/ra/skills"));
    expect(box).toHaveValue("Power BI, Visio, Excel");
  });

  it("an attached resume can be viewed or replaced from the card", async () => {
    serve([{ ...TRACK, resume_id: "r1", resume_filename: "it-admin.pdf" }]);
    renderWithQuery(<ResumeTypes />);
    expect(await screen.findByText("it-admin.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("edits a type and sends clean lists", async () => {
    serve([TRACK]);
    patch.mockResolvedValue(TRACK);
    const user = userEvent.setup();
    renderWithQuery(<ResumeTypes />);

    await user.click(await screen.findByRole("button", { name: /edit/i }));
    const skills = screen.getByLabelText(/key skills/i);
    await user.clear(skills);
    await user.type(skills, "Microsoft 365, Entra ID,  PowerShell");
    const pay = screen.getByLabelText(/minimum pay/i);
    await user.clear(pay);
    await user.type(pay, "$75K");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0];
    expect(path).toBe("/v1/scout/tracks/t1");
    expect(body.key_skills).toEqual(["Microsoft 365", "Entra ID", "PowerShell"]);
    expect(body.min_pay).toBe(75000);
    expect(body.target_titles).toEqual(TRACK.target_titles);
  });

  it("adds related titles, keeps titles loose, and the degree rule off", async () => {
    serve([TRACK]);
    patch.mockResolvedValue(TRACK);
    const user = userEvent.setup();
    renderWithQuery(<ResumeTypes />);
    await user.click(await screen.findByRole("button", { name: /edit/i }));
    await user.type(
      screen.getByLabelText(/also search for/i),
      "Systems Administrator{Enter}M365 Admin",
    );
    expect(screen.getByRole("switch", { name: /exact titles only/i })).not.toBeChecked();
    // An older type with the degree rule on: one tap turns it off.
    expect(screen.getByText(/On: Claude passes these jobs over/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: /needs a degree/i }));
    expect(screen.getByText(/Off: these jobs are scored like any other/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [, body] = patch.mock.calls[0];
    expect(body.related_titles).toEqual(["Systems Administrator", "M365 Admin"]);
    expect(body.exact_titles).toBe(false);
    expect(body.skip_rules.degree_only).toBe(false);
  });

  it("fills skills from the main resume, and starts a type fresh", async () => {
    const blank = { ...TRACK, key_skills: [] };
    get.mockImplementation((path: string) => {
      if (path === "/v1/scout/tracks") return Promise.resolve([blank]);
      if (path === "/v1/ai/resumes")
        return Promise.resolve([{ id: "cv", filename: "cv.pdf", is_active: true }]);
      if (path === "/v1/ai/resumes/cv/skills")
        return Promise.resolve({ skills: ["Microsoft 365", "Entra ID"] });
      if (path === "/v1/scout/tracks/t1/passes")
        return Promise.resolve({
          count: 3,
          titles: [{ title: "registered nurse", times: 2 }, { title: "barista", times: 1 }],
          since: null,
        });
      return Promise.resolve([]);
    });
    patch.mockResolvedValue(blank);
    post.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithQuery(<ResumeTypes />);
    await user.click(
      await screen.findByRole("button", { name: /fill skills from my resume/i }),
    );
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/scout/tracks/t1", {
        key_skills: ["Microsoft 365", "Entra ID"],
      }),
    );
    expect(await screen.findByText("3 titles Claude passed over")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText("registered nurse")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start fresh" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/scout/tracks/t1/start-fresh", {}),
    );
  });

  it("explains a bad pay instead of saving", async () => {
    serve([TRACK]);
    const user = userEvent.setup();
    renderWithQuery(<ResumeTypes />);
    await user.click(await screen.findByRole("button", { name: /edit/i }));
    const pay = screen.getByLabelText(/minimum pay/i);
    await user.clear(pay);
    await user.type(pay, "lots");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/should look like 70000/i)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});
