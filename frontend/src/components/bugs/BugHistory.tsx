import { Button } from "@/components/ui/button";
import { WHO } from "@/components/bugs/BugNotes";
import { useSplitBug } from "@/hooks/useBugReports";
import {
  type BugEvent,
  type BugSection,
  type BugSeverity,
  type BugStatus,
  SECTION_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
} from "@/lib/bugs";
import { utcTime } from "@/lib/bugReport";

const FIELD: Record<string, string> = {
  title: "Title",
  section: "Section",
  severity: "Severity",
  type: "Bug or idea",
  steps: "Steps",
  actual: "What happened",
  expected: "What was expected",
  place: "Where",
  box: "Box",
  fixed_in: "Fixed in",
  confidence: "How sure",
};

function value(field: string, v: unknown): string {
  if (field === "section") return SECTION_LABEL[v as BugSection] ?? String(v);
  if (field === "severity")
    return SEVERITY_LABEL[v as BugSeverity] ?? String(v);
  if (field === "type") return v === "bug" ? "Bug" : "Idea";
  return String(v ?? "");
}

/** One line of history, in plain words. */
export function describe(e: BugEvent): string {
  const d = e.data as Record<string, unknown>;
  const status = (s: unknown) => STATUS_LABEL[s as BugStatus] ?? String(s);
  switch (e.kind) {
    case "status":
      if (d.came_back)
        return `Came back${d.fixed_in ? ` after the ${String(d.fixed_in)} fix` : ""}`;
      return `${status(d.from)} → ${status(d.to)}${d.fixed_in ? ` (in ${String(d.fixed_in)})` : ""}`;
    case "edit": {
      const field = String(d.field);
      if (field === "checked") return "Looks fixed";
      if (field === "pinned") return d.to ? "Pinned" : "Unpinned";
      // A service that was down is back (the health watch).
      if (field === "recovered") return "Back up";
      if (["section", "severity", "type"].includes(field)) {
        return `${FIELD[field]}: ${value(field, d.from)} → ${value(field, d.to)}`;
      }
      return `${FIELD[field] ?? field} changed`;
    }
    case "seen":
      return `Happened again${d.place ? ` on ${String(d.place)}` : ""}`;
    case "merge":
      return `Merged in: ${String(d.title ?? "a report")}`;
    case "split":
      return `Split back out: ${String(d.title ?? "a report")}`;
    case "link":
      return `Linked to ${String(d.title ?? "a report")}`;
    case "unlink":
      return "Unlinked a report";
    default:
      return e.kind;
  }
}

/** Every change (who and when), the times it happened, merges and links;
 * notes have their own list. A merge can be split back from here. */
export function BugHistory({ id, events }: { id: string; events: BugEvent[] }) {
  const split = useSplitBug();
  const shown = events.filter((e) => e.kind !== "note");
  return (
    <section aria-labelledby={`history-${id}`} className="space-y-2">
      <h3 id={`history-${id}`} className="text-sm font-semibold">
        History
      </h3>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <ol className="space-y-1.5 border-l pl-3">
          {shown.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="break-words">{describe(e)}</p>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {WHO[e.by]} · <time dateTime={e.at}>{utcTime(e.at)}</time>
                {e.kind === "merge" && !e.data.split && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs pointer-coarse:h-auto"
                    disabled={split.isPending}
                    onClick={() => split.mutate({ id, eventId: e.id })}
                  >
                    Split back
                  </Button>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
