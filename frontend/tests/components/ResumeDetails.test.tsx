import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn().mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" })),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ResumeDetailsCard } from "@/components/autofill/ResumeDetailsCard";
import { JobResumePicker } from "@/components/jobs/JobResumePicker";
import { SavedAnswersCard } from "@/components/settings/SavedAnswersCard";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const RESUMES = [
  { id: "r1", filename: "wren.pdf", is_active: true },
  { id: "r2", filename: "wren-data.pdf", is_active: false },
];
const DETAILS = {
  resume_id: "r1",
  filename: "wren.pdf",
  read: true,
  work: [{ title: "Data Analyst", company: "Tidewell Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true, description: "Dashboards" }],
  education: [],
  skills: ["SQL", "Python"],
  certifications: [],
  websites: ["https://github.com/wren"],
};

beforeEach(() => {
  get.mockReset();
  put.mockReset().mockImplementation((_url: string, body: object) => Promise.resolve({ ...DETAILS, ...body }));
  post.mockReset().mockResolvedValue(DETAILS);
});

describe("Your résumé details", () => {
  it("shows what was read, asks to check it, and saves corrections", async () => {
    get.mockImplementation((url: string) => Promise.resolve(url === "/v1/ai/resumes" ? RESUMES : DETAILS));
    wrap(<ResumeDetailsCard />);
    expect(await screen.findByText(/Check these: read from your résumé/)).toBeInTheDocument();
    const title = screen.getByLabelText("Job 1 title");
    expect(title).toHaveValue("Data Analyst");
    await userEvent.clear(title);
    await userEvent.type(title, "Senior Data Analyst");
    await userEvent.type(screen.getByLabelText("Skills"), "\nLooker");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(put).toHaveBeenCalledWith(
      "/v1/autofill/resumes/r1/details",
      expect.objectContaining({
        skills: ["SQL", "Python", "Looker"],
        work: [expect.objectContaining({ title: "Senior Data Analyst", company: "Tidewell Labs" })],
      }),
    );
  });

  it("an unread résumé says so, and Read my résumé reads it", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(url === "/v1/ai/resumes" ? RESUMES : { ...DETAILS, read: false, work: [], skills: [], websites: [] }),
    );
    wrap(<ResumeDetailsCard />);
    expect(await screen.findByText(/hasn't been read yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read my résumé" }));
    expect(post).toHaveBeenCalledWith("/v1/autofill/resumes/r1/read", undefined);
  });
});

describe("Résumé for this job", () => {
  it("picks the résumé Job Catcher uses for one saved job", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/v1/ai/resumes"
          ? RESUMES
          : [{ id: "sj1", job_listing_id: "l1", resume_id: null, job_listing: { title: "Analyst", company: "Kelso" } }],
      ),
    );
    put.mockResolvedValue(undefined);
    wrap(<JobResumePicker jobListingId="l1" />);
    const pick = await screen.findByLabelText("Résumé for this job");
    await userEvent.selectOptions(pick, "r2");
    expect(put).toHaveBeenCalledWith("/v1/saved-jobs/sj1/resume", { resume_id: "r2", usual: false });
  });

  it("views the résumé for this job right there: the picked one, else your usual one", async () => {
    let chosen: string | null = null;
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/v1/ai/resumes"
          ? RESUMES
          : [{ id: "sj1", job_listing_id: "l1", resume_id: chosen, job_listing: { title: "Analyst", company: "Kelso" } }],
      ),
    );
    const { unmount } = wrap(<JobResumePicker jobListingId="l1" />);
    expect(await screen.findByRole("button", { name: "View wren.pdf" })).toBeInTheDocument();
    unmount();
    chosen = "r2";
    wrap(<JobResumePicker jobListingId="l1" />);
    await userEvent.click(await screen.findByRole("button", { name: "View wren-data.pdf" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("wren-data.pdf");
  });
});

describe("Answers for every site", () => {
  it("labels an answer learned for a kind of box", async () => {
    get.mockResolvedValue([{ question_key: "@preferred_name", question_text: "Preferred First Name", answer: "Ren" }]);
    wrap(<SavedAnswersCard />);
    expect(await screen.findByText("Every site: every preferred name box")).toBeInTheDocument();
  });
});
