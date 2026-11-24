import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { LanguagesCard } from "@/components/autofill/LanguagesCard";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ENGLISH = { language: "English", native: true, overall: 5, comprehension: null, reading: null, speaking: null, writing: null };

beforeEach(() => {
  get.mockReset().mockResolvedValue({ first_name: "Wren", languages: [ENGLISH] });
  put.mockReset().mockImplementation(async (_url: string, body: object) => ({ first_name: "Wren", ...body }));
});

describe("Languages on Autofill memory", () => {
  it("shows the saved languages; adding one with levels saves only the languages", async () => {
    wrap(<LanguagesCard />);
    expect(await screen.findByDisplayValue("English")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add a language/ }));
    await userEvent.type(screen.getByLabelText("Language 2"), "Spanish");
    await userEvent.selectOptions(screen.getByLabelText("Spanish understanding level"), "4");
    await userEvent.selectOptions(screen.getByLabelText("Spanish writing level"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Save languages" }));
    expect(put).toHaveBeenCalledWith("/v1/users/me/application-profile", {
      languages: [ENGLISH, { language: "Spanish", native: false, overall: null, comprehension: 4, reading: null, speaking: null, writing: 3 }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("removes a language; an unnamed one isn't saved", async () => {
    wrap(<LanguagesCard />);
    await screen.findByDisplayValue("English");
    await userEvent.click(screen.getByRole("button", { name: "Remove English" }));
    await userEvent.click(screen.getByRole("button", { name: /Add a language/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save languages" }));
    expect(put).toHaveBeenCalledWith("/v1/users/me/application-profile", { languages: [] });
  });
});
