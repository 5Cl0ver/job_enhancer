import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { JobEmails } from "@/components/email/JobEmails";

const EXACT = "https://mail.yahoo.com/d/folders/1/messages/AHv3oRrlHYyYacYYwjlWCQNEtA0";
const SEARCH = "https://mail.yahoo.com/d/search/keyword=Phone%20screen%20talent%40vellacor.example";

const MOVED = {
  id: "e1",
  saved_job_id: "s1",
  event_type: "interview",
  target_stage: "Phone Screen",
  status: "auto_applied",
  company: "Vellacor",
  title: "IT Systems Administrator",
  from_addr: "talent@vellacor.example",
  subject: "Phone screen",
  mail_link: EXACT,
  mail_search_link: SEARCH,
  created_at: "2026-11-18T10:00:00Z",
};
const WAITING = {
  ...MOVED,
  id: "e2",
  event_type: "assessment",
  target_stage: "Take-Home Assignment",
  status: "pending",
  mail_link: SEARCH,
  mail_search_link: SEARCH,
};

let emails: unknown[] = [];
const MESSAGE = {
  subject: "Phone screen",
  from_addr: "talent@vellacor.example",
  date: "2026-11-18T10:00:00Z",
  text: "We'd like to set up a 30 minute call.",
  mail_link: EXACT,
  mail_search_link: SEARCH,
};

function renderEmails(props: { sayWhenNone?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobEmails jobListingId="listing-1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  emails = [MOVED, WAITING];
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith("/v1/email/job-emails")) return Promise.resolve(emails);
    if (path.includes("/message")) return Promise.resolve(MESSAGE);
    return Promise.resolve([]);
  });
});

describe("JobEmails", () => {
  it("says what each email was and what it did to the card", async () => {
    renderEmails();
    expect(await screen.findByText("Emails about this job (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Vellacor invited you to interview for IT Systems Administrator."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Moved this job to Phone Screen automatically/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for you on Email updates/)).toBeInTheDocument();
  });

  it("links each email straight to the message in the user's own mail", async () => {
    renderEmails();
    const links = await screen.findAllByRole("link", { name: /Open in Yahoo Mail/ });
    expect(links[0]).toHaveAttribute("href", EXACT);
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("opens a quick view with the text, the direct link and a search fallback", async () => {
    const user = userEvent.setup();
    renderEmails();
    await user.click((await screen.findAllByRole("button", { name: "View email" }))[0]);

    const view = await screen.findByRole("dialog");
    expect(await within(view).findByText(/30 minute call/)).toBeInTheDocument();
    expect(within(view).getByRole("link", { name: /Open in Yahoo Mail/ })).toHaveAttribute(
      "href",
      EXACT,
    );
    expect(within(view).getByRole("link", { name: /Search for it/ })).toHaveAttribute(
      "href",
      SEARCH,
    );
  });

  it("shows nothing for a job with no emails, unless asked to say so", async () => {
    emails = [];
    const { container, unmount } = renderEmails();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    renderEmails({ sayWhenNone: true });
    expect(await screen.findByText(/No email is linked to this job/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan your inbox" })).toHaveAttribute(
      "href",
      "/email-updates",
    );
  });
});
