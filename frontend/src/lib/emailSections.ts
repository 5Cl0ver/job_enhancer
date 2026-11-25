/**
 * A job's emails in sections (spec 027): what each email is, where it goes on
 * the job's page, and the one-line summary on top. Pure, so it's tested alone.
 */
import type { DetectedEvent } from "@/hooks/useEmailAccount";

export type SectionKey =
  "next" | "decisions" | "application" | "people" | "other";

export const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: "next", title: "Interviews & next steps" },
  { key: "decisions", title: "Decisions" },
  { key: "application", title: "Your application" },
  { key: "people", title: "Messages from people" },
  { key: "other", title: "Other" },
];

export function sectionOf(
  ev: Pick<DetectedEvent, "event_type" | "status">,
): SectionKey {
  switch (ev.event_type) {
    case "interview":
    case "assessment":
      return "next";
    case "offer":
    case "rejected":
      return "decisions";
    case "applied":
      return "application";
    case "recruiter":
      return "people";
    default:
      return ev.status === "contact" ? "people" : "other";
  }
}

const KIND: Record<string, string> = {
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejected: "Rejection",
  applied: "Application received",
  recruiter: "Message from a recruiter",
};

export const kindOf = (ev: Pick<DetectedEvent, "event_type">) =>
  KIND[ev.event_type] ?? "Email";

const sentAt = (ev: Pick<DetectedEvent, "email_date" | "created_at">) =>
  new Date(ev.email_date ?? ev.created_at).getTime();

/** Newest first. */
export function newestFirst<
  T extends Pick<DetectedEvent, "email_date" | "created_at">,
>(list: T[]): T[] {
  return [...list].sort((a, b) => sentAt(b) - sentAt(a));
}

/** The sections that have emails, in order, each newest first. */
export function groupBySection(
  emails: DetectedEvent[],
): { key: SectionKey; title: string; emails: DetectedEvent[] }[] {
  return SECTIONS.map((s) => ({
    ...s,
    emails: newestFirst(emails.filter((e) => sectionOf(e) === s.key)),
  })).filter((s) => s.emails.length > 0);
}

/** "Latest: Interview · Nov 25". */
export function latestLine(
  emails: DetectedEvent[],
  now = new Date(),
): string | null {
  const [latest] = newestFirst(emails);
  if (!latest) return null;
  const when = new Date(latest.email_date ?? latest.created_at);
  const day = when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `Latest: ${kindOf(latest)} · ${day}`;
}

/** New = kept on the job and not seen yet. */
export const isNew = (
  ev: Pick<DetectedEvent, "status"> & { seen_at?: string | null },
) => ev.status === "noted" && !ev.seen_at;
