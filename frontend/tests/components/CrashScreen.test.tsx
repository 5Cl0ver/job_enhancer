// Spec 032: a page that breaks shows a friendly crash screen (Reload, Go
// home) for everyone, keeps the menu when only the page broke, and the crash
// is reported once.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportCaught = vi.fn();

vi.mock("@/lib/catchErrors", () => ({
  reportCaught: (...a: unknown[]) => reportCaught(...a),
}));

import { CrashScreen } from "@/components/bugs/CrashScreen";

function Broken(): never {
  throw new TypeError("job.title is undefined");
}

function Layout() {
  return (
    <div>
      <nav>The menu</nav>
      <Outlet />
    </div>
  );
}

beforeEach(() => {
  reportCaught.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("CrashScreen", () => {
  it("says something went wrong, offers Reload and Go home, and reports it", async () => {
    const router = createMemoryRouter(
      [{ path: "/jobs", element: <Broken />, errorElement: <CrashScreen /> }],
      { initialEntries: ["/jobs"] },
    );
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();

    expect(reportCaught).toHaveBeenCalledTimes(1);
    const [error, opts] = reportCaught.mock.calls[0];
    expect((error as Error).message).toBe("job.title is undefined");
    expect(opts).toEqual({ kind: "crash" });
  });

  it("keeps the menu when only the page broke", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Layout />,
          errorElement: <CrashScreen />,
          children: [
            {
              errorElement: <CrashScreen />,
              children: [{ path: "jobs", element: <Broken /> }],
            },
          ],
        },
      ],
      { initialEntries: ["/jobs"] },
    );
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The menu")).toBeInTheDocument();
  });

  it("doesn't report a page that wasn't found", async () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <div />, errorElement: <CrashScreen /> }],
      { initialEntries: ["/nowhere"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "Something went wrong" });
    expect(reportCaught).not.toHaveBeenCalled();
  });
});
