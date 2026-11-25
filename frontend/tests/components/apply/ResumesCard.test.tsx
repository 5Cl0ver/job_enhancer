import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
  ApiError: class extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ResumesCard } from "@/components/settings/ResumesCard";

const r = (id: string, filename: string, extra = {}) => ({
  id,
  user_id: "u",
  filename,
  mime_type: "application/pdf",
  file_size_bytes: 1,
  is_active: false,
  is_master: false,
  document_id: null,
  created_at: "",
  ...extra,
});

beforeEach(() => {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/v1/profile-facts"
        ? [{ id: "f1", question: "Used Okta?", answer: "Yes, SSO", saved_job_id: null }]
        : [
            r("a", "usual.pdf", { is_active: true }),
            r("b", "everything.pdf"),
            r("c", "Sam - Résumé.pdf", { document_id: "d1" }),
          ],
    ),
  );
  put.mockResolvedValue({});
  del.mockResolvedValue(null);
  patch.mockResolvedValue({});
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ResumesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Settings › Résumés", () => {
  it("the usual one is the master until another is picked", async () => {
    renderCard();
    expect(await screen.findByText("Master")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Make master/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/v1/ai/resumes/b/master", {}));
  });

  it("a résumé made for a job can be deleted; the usual one can't", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();
    expect(await screen.findByText("Made for a job")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete usual.pdf" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Delete Sam - Résumé.pdf" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/v1/ai/resumes/c"));
  });

  it("shows, edits and deletes the things told to Claude", async () => {
    renderCard();
    expect(await screen.findByText("Used Okta?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit the answer to: Used Okta?" }));
    const box = screen.getByLabelText("Answer to: Used Okta?");
    await userEvent.clear(box);
    await userEvent.type(box, "Yes, SSO for 40 apps");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/v1/profile-facts/f1", { answer: "Yes, SSO for 40 apps" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete: Used Okta?" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/v1/profile-facts/f1"));
  });
});
