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
