import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { JobEmails } from "@/components/email/JobEmails";
import { LookedAtList, NewOnYourJobs } from "@/components/email/JobEmailLists";
import { groupBySection, latestLine, sectionOf } from "@/lib/emailSections";
import type { DetectedEvent } from "@/hooks/useEmailAccount";

const ev = (id: string, event_type: string, day: number, extra: Partial<DetectedEvent> = {}): DetectedEvent =>
  ({
    id,
    saved_job_id: "sj1",
    job_listing_id: "l1",
    event_type,
    target_stage: null,
    from_addr: "Brightwave <jobs@brightwave.example>",
    subject: `${event_type} ${id}`,
    status: "noted",
    email_date: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
    created_at: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
    company: "Brightwave",
    title: "IT Engineer",
    seen_at: "2026-11-25T00:00:00Z",
    ...extra,
  }) as DetectedEvent;

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("sections (spec 027)", () => {
  it("puts each kind of email in its section, newest first, with a summary", () => {
    expect(sectionOf({ event_type: "assessment", status: "noted" })).toBe("next");
    expect(sectionOf({ event_type: "rejected", status: "applied" })).toBe("decisions");
    expect(sectionOf({ event_type: "unsure", status: "contact" })).toBe("people");
    const list = [ev("a", "applied", 20), ev("b", "interview", 23), ev("c", "interview", 25), ev("d", "unsure", 1)];
    expect(groupBySection(list).map((s) => [s.title, s.emails.map((e) => e.id)])).toEqual([
      ["Interviews & next steps", ["c", "b"]],
      ["Your application", ["a"]],
      ["Other", ["d"]],
    ]);
    expect(latestLine(list, new Date("2026-11-26"))).toBe("Latest: Interview · Nov 25");
  });
});

describe("the job's emails (spec 027)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset().mockResolvedValue(undefined);
  });

  it("groups them, marks the new one, and tells the app it was seen", async () => {
    get.mockResolvedValue([
      ev("i1", "interview", 25, { seen_at: null }),
      ev("i2", "interview", 20),
      ev("a1", "applied", 18),
      ev("a2", "applied", 17),
      ev("a3", "applied", 16),
      ev("a4", "applied", 15),
    ]);
    wrap(<JobEmails jobListingId="l1" />);
    const next = await screen.findByRole("group", { name: "Interviews & next steps" });
    expect(within(next).getByText("New")).toBeInTheDocument();
    expect(screen.getByText(/^Latest: Interview/)).toBeInTheDocument();
    const app = screen.getByRole("group", { name: "Your application" });
    expect(within(app).getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(within(app).getByRole("button", { name: "Show 1 more" }));
    expect(within(app).getAllByRole("listitem")).toHaveLength(4);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/email/job-emails/seen", { job_listing_id: "l1" }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a kept email can go back with Not this job", async () => {
    get.mockResolvedValue([ev("k1", "applied", 20, { match_evidence: "user_link" })]);
    post.mockResolvedValue(ev("k1", "applied", 20, { status: "skipped" }));
    wrap(<JobEmails jobListingId="l1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Not this job" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/email/events/k1/unkeep", {}));
  });

  it("doesn't call seen when nothing is new", async () => {
    get.mockResolvedValue([ev("i2", "interview", 20)]);
    wrap(<JobEmails jobListingId="l1" />);
    await screen.findByRole("group", { name: "Interviews & next steps" });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Email updates lists (spec 027)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("lists new emails on your jobs, each opening its job", async () => {
    get.mockResolvedValue([ev("n1", "interview", 25, { seen_at: null })]);
    wrap(<NewOnYourJobs />);
    const link = await screen.findByRole("link", { name: /Interview: IT Engineer at Brightwave/ });
    expect(link).toHaveAttribute("href", "/jobs/l1");
  });

  it("puts a looked-at email on the job you pick", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/v1/email/looked-at"
          ? [ev("s1", "applied", 24, { status: "skipped", saved_job_id: null, skip_reason: "digest" })]
          : [
              {
                id: "sj1",
                job_listing_id: "l1",
                is_archived: false,
                job_listing: { id: "l1", title: "IT Engineer", company: "Brightwave" },
              },
            ],
      ),
    );
    post.mockResolvedValue(ev("s1", "applied", 24));
    wrap(<LookedAtList />);
    await userEvent.click(await screen.findByRole("button", { name: /Looked at, not shown \(1\)/ }));
    expect(screen.getByText(/Looks like a list of jobs/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "This is about my job" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Which saved job/ }), "sj1");
    await userEvent.click(screen.getByRole("button", { name: "Put it there" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/v1/email/events/s1/keep", { saved_job_id: "sj1" }));
  });
});
