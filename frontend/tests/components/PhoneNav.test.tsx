import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn().mockResolvedValue({}) } }),
}));

import { TabBar, TopBar } from "@/components/layout/PhoneNav";

function renderBar(props: { emailCount?: number; isAdmin?: boolean } = {}, path = "/jobs") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
      <TabBar emailCount={props.emailCount ?? 0} isAdmin={props.isAdmin ?? false} />
    </MemoryRouter>,
  );
}

describe("phone tab bar", () => {
  it("has My Jobs, Email, Find Jobs and More, in that order", () => {
    renderBar();
    const bar = screen.getByRole("navigation", { name: "Main" });
    const slots = [...bar.querySelectorAll("a, button")].map((el) => el.textContent);
    expect(slots).toEqual(["My Jobs", "Email", "Find Jobs", "More"]);
    expect(within(bar).getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "/email-updates",
    );
  });

  it("shows how many email updates wait, and nothing at zero", () => {
    const { unmount } = renderBar({ emailCount: 4 });
    expect(screen.getByRole("link", { name: /Email/ })).toHaveTextContent("4");
    unmount();
    renderBar({ emailCount: 0 });
    expect(screen.getByRole("link", { name: /Email/ })).toHaveTextContent(/^Email$/);
  });

  it("More opens a sheet with the other pages and Sign out", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: "More" }));

    const sheet = await screen.findByRole("dialog");
    const pages = within(sheet)
      .getAllByRole("link")
      .map((el) => el.textContent);
    expect(pages).toEqual(["Matches", "Analytics", "AI Apply", "Settings"]);
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("lists Admin only for an admin", async () => {
    const user = userEvent.setup();
    renderBar({ isAdmin: true });
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(within(await screen.findByRole("dialog")).getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("marks More as the current tab on a page that lives in it", () => {
    renderBar({}, "/settings");
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("text-primary");
  });
});

describe("phone top bar", () => {
  it("names the page", () => {
    renderBar({}, "/email-updates");
    expect(screen.getByRole("banner")).toHaveTextContent("Email Updates");
  });

  it("offers a way back from a job's own page", () => {
    renderBar({}, "/jobs/123");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("has no back arrow on a top-level page", () => {
    renderBar({}, "/jobs");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
});
