// The app works with no AI (spec 039): while AI writing is off (the default),
// the job page has no "Generate Documents" button that would only fail.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn(),
  },
  ApiError: class extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { JobDetail } from "@/components/jobs/JobDetail";
import type { JobListing } from "@/types/api";

const JOB: JobListing = {
  id: "l1",
  external_id: "x1",
  source: "manual",
  title: "Platform Engineer",
  company: "Northwind Labs",
  location: "Remote",
  is_remote: true,
  description: "Run the platform.",
  salary_min: null,
  salary_max: null,
  salary_period: null,
  currency: null,
  job_type: null,
  apply_url: "https://jobs.example.test/northwind/1",
  posted_at: null,
  is_expired: false,
  created_at: "2026-11-20T10:00:00Z",
};

function usage(on: boolean) {
  return {
    exempt: false,
    resets_at: "",
    kinds: { ai_document: { used: 0, limit: 5, left: 5, on } },
    shared: {},
  };
}

function show(aiOn: boolean) {
  get.mockImplementation((path: string) => Promise.resolve(path === "/v1/usage" ? usage(aiOn) : []));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobDetail job={JOB} isSaved onGenerateDocuments={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => get.mockReset());

describe("Generate Documents on the job page", () => {
  it("is hidden while AI writing is off", async () => {
    show(false);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/v1/usage"));
    expect(await screen.findByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Documents" })).toBeNull();
  });

  it("shows when AI writing is on", async () => {
    show(true);
    expect(await screen.findByRole("button", { name: "Generate Documents" })).toBeInTheDocument();
  });
});
