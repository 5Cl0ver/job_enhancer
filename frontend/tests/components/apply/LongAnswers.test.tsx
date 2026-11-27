// Long answers in full (spec 039): a Workday answer of 1,500 characters with
// line breaks shows whole, folds to 4 lines in the list with "Show all", and
// edits in a growing box that starts with the answer.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixSheet, RowButton } from "@/components/apply/Bubbles";

const LONG =
  "At Northwind Labs I led the move of 40 internal apps to single sign-on.\n\n" +
  Array(20).fill("We planned it in waves, tested each with its team, and kept a way back.").join(" ") +
  "\nIt finished a month early.";
const Q = "Tell us about a project you led";

const target = (a: string, extra = {}) => ({ step: "questions", stepTitle: "Application Questions", q: Q, a, k: 1, ...extra });

afterEach(() => vi.restoreAllMocks());

describe("a long answer in the list", () => {
  it("is all there, line breaks and all", () => {
    render(<RowButton row={{ q: Q, a: LONG }} onTap={() => {}} />);
    const text = screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === LONG);
    expect(text).toHaveClass("whitespace-pre-wrap");
    expect(screen.getByRole("button", { name: new RegExp(`^${Q}`) })).toBeInTheDocument();
  });

  it("folds to 4 lines with Show all when it runs past them", async () => {
    // jsdom has no layout: say the text runs past its 4 lines.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    render(<RowButton row={{ q: Q, a: LONG }} onTap={() => {}} />);
    const text = screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === LONG);
    expect(text).toHaveClass("line-clamp-4");
    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(text).not.toHaveClass("line-clamp-4");
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(text).toHaveClass("line-clamp-4");
  });

  it("a short answer never folds", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    render(<RowButton row={{ q: "City", a: "Eugene" }} onTap={() => {}} />);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.getByText("Eugene")).not.toHaveClass("line-clamp-4");
  });
});

describe("changing a long answer", () => {
  it("shows it in full and edits it in a box that starts with it", async () => {
    const onSave = vi.fn();
    render(<FixSheet target={target(LONG)} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === LONG)).toBeInTheDocument();
    const box = screen.getByLabelText("Change it to");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveValue(LONG);
    // Unchanged isn't a change.
    expect(screen.getByRole("button", { name: "Add fix" })).toBeDisabled();
    await userEvent.type(box, " Thanks.");
    await userEvent.click(screen.getByRole("button", { name: "Add fix" }));
    expect(onSave).toHaveBeenCalledWith({ to: `${LONG} Thanks.` });
  });

  it("a short answer keeps its one-line box", () => {
    render(<FixSheet target={target("Eugene")} onSave={() => {}} onClose={() => {}} />);
    const box = screen.getByLabelText("Change it to");
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveValue("");
    expect(screen.getByText("Eugene")).toBeInTheDocument();
  });

  it("an empty box says so", () => {
    render(<FixSheet target={target("")} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Left empty")).toBeInTheDocument();
  });
});
