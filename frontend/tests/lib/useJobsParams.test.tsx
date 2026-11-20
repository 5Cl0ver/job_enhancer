import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useJobsParams } from "@/hooks/useJobsParams";
import { originChoices } from "@/lib/origin";

function Probe() {
  const { folder, origin, setFolder, setOrigin, clear } = useJobsParams();
  const { search } = useLocation();
  return (
    <div>
      <p data-testid="state">{`${folder ?? "-"}|${origin}|${search}`}</p>
      <button onClick={() => setFolder("c2")}>folder</button>
      <button onClick={() => setOrigin("email")}>email</button>
      <button onClick={() => setOrigin("all")}>anywhere</button>
      <button onClick={clear}>clear</button>
    </div>
  );
}

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  );
  return () => screen.getByTestId("state").textContent;
}

describe("useJobsParams", () => {
  it("reads the collection and origin from the address", () => {
    expect(at("/jobs?folder=c1&origin=scout")()).toBe("c1|scout|?folder=c1&origin=scout");
  });

  it("ignores an origin the app doesn't know", () => {
    expect(at("/jobs?origin=bogus")()).toBe("-|all|?origin=bogus");
  });

  it("changes one without losing the other or the view", async () => {
    const state = at("/jobs?view=board&folder=c1");
    await userEvent.click(screen.getByText("email"));
    expect(state()).toBe("c1|email|?view=board&folder=c1&origin=email");
    await userEvent.click(screen.getByText("folder"));
    expect(state()).toBe("c2|email|?view=board&folder=c2&origin=email");
    await userEvent.click(screen.getByText("anywhere"));
    expect(state()).toBe("c2|all|?view=board&folder=c2");
  });

  it("clears both in one go", async () => {
    const state = at("/jobs?folder=c1&origin=scout");
    await userEvent.click(screen.getByText("clear"));
    expect(state()).toBe("-|all|");
  });
});

describe("originChoices", () => {
  it("always offers the origin in force, even with none of it in the list", () => {
    const jobs = [{ origin: "scout" }, { origin: null }];
    expect(originChoices(jobs, "email")).toEqual(["scout", "email"]);
    expect(originChoices(jobs, "all")).toEqual(["scout"]);
    expect(originChoices([], "all")).toEqual([]);
  });
});
