import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();
const del = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    put: vi.fn(),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { TaughtBoxesCard } from "@/components/autofill/TaughtBoxesCard";
import { SavedAnswersCard } from "@/components/settings/SavedAnswersCard";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue(undefined);
});

describe("Boxes you taught (Autofill memory)", () => {
  it("lists taught boxes by site; a typed answer is changed in place, any box removed", async () => {
    get.mockResolvedValue([
      { id: "t1", site: "www.paycomonline.net", label: "legal first name", profile_key: "first_name", answer: null },
      { id: "t2", site: "careers.brightfold.example", label: "referral source", profile_key: null, answer: "A former colleague" },
    ]);
    wrap(<TaughtBoxesCard />);
    const paycom = await screen.findByRole("region", { name: "www.paycomonline.net" });
    expect(within(paycom).getByText("First name")).toBeInTheDocument();

    const box = screen.getByLabelText("Answer for referral source on careers.brightfold.example");
    await userEvent.clear(box);
    await userEvent.type(box, "Employee referral");
    const row = box.closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(patch).toHaveBeenCalledWith("/v1/autofill/taught/t2", { answer: "Employee referral" });

    await userEvent.click(screen.getByRole("button", { name: "Remove legal first name on www.paycomonline.net" }));
    expect(del).toHaveBeenCalledWith("/v1/autofill/taught/t1");
  });

  it("says how to teach one when there are none", async () => {
    get.mockResolvedValue([]);
    wrap(<TaughtBoxesCard />);
    expect(await screen.findByText(/Point at a box/)).toBeInTheDocument();
  });
});

describe("Saved answers show where each is used", () => {
  it("marks one-company answers and essays; opens filtered from the side panel", async () => {
    get.mockResolvedValue([
      { question_key: "which shift do you prefer", question_text: "Which shift do you prefer?", answer: "Mornings" },
      { question_key: "opus.example|have you worked for our company before", question_text: "Have you worked for our company before?", answer: "No" },
      { question_key: "essay|why do you want to work here", question_text: "Why do you want to work here?", answer: "Because…" },
    ]);
    wrap(<SavedAnswersCard initialQuery="worked for" />);
    expect(await screen.findByText("Only for opus.example")).toBeInTheDocument();
    expect(screen.queryByText("Which shift do you prefer?")).not.toBeInTheDocument(); // filtered
  });
});
