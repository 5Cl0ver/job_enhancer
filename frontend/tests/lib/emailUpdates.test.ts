import { describe, it, expect } from "vitest";
import {
  categoryOf,
  collapseRepeats,
  group,
  question,
  reason,
  scanIsDone,
  sentence,
} from "@/lib/emailUpdates";
import type { DetectedEvent, ScanResult } from "@/hooks/useEmailAccount";
import { readableError } from "@/lib/api";

// Fictional events — only the fields the helpers read.
function ev(o: Partial<DetectedEvent> = {}): DetectedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    saved_job_id: "s1",
    job_listing_id: null,
    event_type: "rejected",
    target_stage: "Rejected",
    from_addr: "Talent <talent@acme.example>",
    subject: "Your application",
    status: "pending",
    mail_link: null,
    created_at: "2026-11-01T10:00:00Z",
    ...o,
  };
}

describe("sentence", () => {
  it("says what happened in plain words", () => {
    const base = { company: "Acme", title: "Support Engineer" };
    expect(sentence(ev(base))).toBe("Acme rejected your Support Engineer application.");
    expect(sentence(ev({ ...base, event_type: "interview" }))).toBe(
      "Acme invited you to interview for Support Engineer.",
    );
    expect(sentence(ev({ ...base, event_type: "offer" }))).toBe(
      "Acme made you an offer for Support Engineer.",
    );
    expect(sentence(ev({ ...base, event_type: "assessment" }))).toBe(
      "Acme sent you an assessment for Support Engineer.",
    );
    expect(sentence(ev({ ...base, event_type: "applied" }))).toBe(
      "Acme received your Support Engineer application.",
    );
  });

  it("never shows a technical label when names are missing", () => {
    const s = sentence(ev({ company: null, title: null, event_type: "unsure" }));
    expect(s).not.toMatch(/unsure|needs_review|several_roles/);
    expect(sentence(ev({ company: null, title: null }))).toBe(
      "A company rejected your application.",
    );
  });
});

describe("question", () => {
  it("names the shared company and asks which job", () => {
    const q = question(
      ev({
        status: "needs_review",
        saved_job_id: null,
        candidates: [
          { company: "Acme", title: "Backend", job_listing_id: null, saved_job_id: "a" },
          { company: "Acme", title: "Frontend", job_listing_id: null, saved_job_id: "b" },
        ],
      }),
    );
    expect(q).toBe("Acme rejected one of your applications. Which job was it?");
  });
});

describe("group", () => {
  it("orders important updates and separates confirmations, questions, hidden", () => {
    const g = group([
      ev({ event_type: "rejected" }),
      ev({ event_type: "applied", target_stage: "Applied" }),
      ev({ event_type: "interview", target_stage: "Interview" }),
      ev({ status: "needs_review", event_type: "offer", saved_job_id: null }),
      ev({ status: "hidden", event_type: "unsure", target_stage: null }),
      ev({ status: "needs_review", event_type: "applied" }), // older row: hidden
    ]);
    expect(g.important.map((e) => e.event_type)).toEqual(["interview", "rejected"]);
    expect(g.confirmations).toHaveLength(1);
    expect(g.questions.map((e) => e.event_type)).toEqual(["offer"]);
    expect(g.hidden).toHaveLength(2);
  });

  it("keeps cards the scan moved by itself apart, so each can be undone", () => {
    const g = group([
      ev({ status: "auto_applied", event_type: "rejected" }),
      ev({ status: "auto_applied", event_type: "interview", target_stage: "Interview" }),
      ev({ event_type: "rejected" }),
    ]);
    expect(g.moved).toHaveLength(2);
    expect(g.important).toHaveLength(1);
    expect(categoryOf(ev({ status: "auto_applied" }))).toBe("moved");
  });

  it("trusts the server's category when it sends one", () => {
    expect(categoryOf(ev({ category: "hidden" }))).toBe("hidden");
  });
});

describe("collapseRepeats", () => {
  it("shows one line per job and update type, newest first", () => {
    const lines = collapseRepeats([
      ev({ id: "n", saved_job_id: "j1", created_at: "2026-11-03T00:00:00Z" }),
      ev({ id: "o", saved_job_id: "j1", created_at: "2026-11-01T00:00:00Z" }),
      ev({ id: "x", saved_job_id: "j2" }),
      ev({ id: "i", saved_job_id: "j1", event_type: "interview" }),
    ]);
    expect(lines.map((l) => [l.lead.id, l.repeats.map((r) => r.id)])).toEqual([
      ["n", ["o"]],
      ["x", []],
      ["i", []],
    ]);
  });

  it("never merges items without a job", () => {
    const lines = collapseRepeats([ev({ saved_job_id: null }), ev({ saved_job_id: null })]);
    expect(lines).toHaveLength(2);
  });
});

describe("jobs you didn't save and recruiter messages", () => {
  const unsaved = (o: Partial<DetectedEvent> = {}) =>
    ev({ status: "unsaved", saved_job_id: null, company: "Vellacor", title: "Data Engineer", ...o });

  it("gets its own sections, apart from updates that move cards", () => {
    const g = group([
      unsaved(),
      ev({ status: "contact", event_type: "recruiter", target_stage: null }),
      ev({ event_type: "interview", target_stage: "Interview" }),
    ]);
    expect(g.unsaved).toHaveLength(1);
    expect(g.contacts).toHaveLength(1);
    expect(g.important.map((e) => e.event_type)).toEqual(["interview"]);
  });

  it("says what happened, using the names read from the email", () => {
    expect(sentence(unsaved())).toBe("Vellacor rejected your Data Engineer application.");
    expect(
      sentence(ev({ status: "contact", event_type: "recruiter", company: "Tidelock", title: null })),
    ).toBe("A recruiter from Tidelock reached out.");
  });

  it("groups repeats of the same unsaved job, but not different jobs", () => {
    const lines = collapseRepeats([
      unsaved({ id: "a" }),
      unsaved({ id: "b" }),
      unsaved({ id: "c", title: "Platform Engineer" }),
      unsaved({ id: "d", company: null }),
      unsaved({ id: "e", company: null }),
    ]);
    expect(lines.map((l) => [l.lead.id, l.repeats.map((r) => r.id)])).toEqual([
      ["a", ["b"]],
      ["c", []],
      ["d", []],
      ["e", []],
    ]);
  });
});

describe("reason", () => {
  it("explains evidence in plain words, only for details", () => {
    expect(reason(ev({ match_evidence: "company_title" }))).toBe(
      "The email names the company and the job title.",
    );
    expect(reason(ev({ match_evidence: null }))).toBeNull();
  });
});

describe("scanIsDone", () => {
  const pass = (o: Partial<ScanResult> = {}): ScanResult => ({
    detected: 0,
    events: [],
    considered: [],
    scanned: 10,
    candidates: 1,
    window_days: 45,
    folders: [{ role: "inbox", status: "complete", carried_over: 0 }],
    carried_over: 0,
    interrupted: null,
    ...o,
  });

  it("stops once every folder is read", () => {
    expect(scanIsDone(pass())).toBe(true);
  });

  it("keeps going while mail is left or a pass was cut short", () => {
    expect(
      scanIsDone(pass({ folders: [{ role: "inbox", status: "carried_over", carried_over: 40 }] })),
    ).toBe(false);
    expect(scanIsDone(pass({ carried_over: 3 }))).toBe(false);
    expect(scanIsDone(pass({ interrupted: "connection_lost" }))).toBe(false);
  });
});

describe("readableError", () => {
  it("shows the server's sentence, not its JSON", () => {
    expect(readableError('{"detail":"This email is no longer in your mailbox."}')).toBe(
      "This email is no longer in your mailbox.",
    );
    expect(readableError("Bad gateway")).toBe("Bad gateway");
  });
});

describe("mailName / emailLabel", () => {
  it("names the mail site a link goes to", async () => {
    const { mailName } = await import("@/lib/emailUpdates");
    expect(mailName("https://mail.yahoo.com/d/folders/1/messages/abc")).toBe("Yahoo Mail");
    expect(mailName("https://mail.google.com/mail/u/0/#search/x")).toBe("Gmail");
    expect(mailName("https://mail.aol.com/d/search/keyword=x")).toBe("AOL Mail");
    expect(mailName("https://example.com/mail")).toBe("your mail");
  });

  it("labels an email on a card by what it is", async () => {
    const { emailLabel } = await import("@/lib/emailUpdates");
    expect(emailLabel("interview")).toBe("Interview email");
    expect(emailLabel("rejected")).toBe("Rejection email");
    expect(emailLabel("unsure")).toBe("Email");
  });
});
