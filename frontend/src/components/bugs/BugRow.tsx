import { formatDistanceToNowStrict } from "date-fns";
import { Check, Pin, RotateCcw } from "lucide-react";
import {
  type BugRow as Row,
  type BugSeverity,
  type BugStatus,
  SECTION_LABEL,
  SEVERITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
} from "@/lib/bugs";
import { cn } from "@/lib/utils";

const SEVERITY_TONE: Record<BugSeverity, string> = {
  blocker: "bg-red-500/15 text-red-700 dark:text-red-300",
  major: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  minor: "bg-muted text-muted-foreground",
};

const STATUS_TONE: Partial<Record<BugStatus, string>> = {
  new: "bg-primary/15 text-primary",
  confirmed: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  working: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  planned: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  fixed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const PILL =
  "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium whitespace-nowrap";

export function SeverityPill({ severity }: { severity: BugSeverity | null }) {
  if (!severity) return null;
  return (
    <span className={cn(PILL, SEVERITY_TONE[severity])}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusPill({ status }: { status: BugStatus }) {
  return (
    <span
      className={cn(
        PILL,
        STATUS_TONE[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ago(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : formatDistanceToNowStrict(d, { addSuffix: true });
}

/**
 * One report in the list: title, then section · severity · status · where it
 * came from · ×N · last seen. In select mode, a tick box instead of opening.
 */
export function BugRow({
  row,
  active,
  selecting,
  selected,
  onOpen,
  onToggle,
}: {
  row: Row;
  active: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={selecting ? onToggle : onOpen}
        aria-pressed={selecting ? selected : undefined}
        aria-current={!selecting && active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors active:bg-accent md:hover:bg-accent/60",
          active && !selecting && "bg-accent",
          selected && "bg-primary/10",
        )}
      >
        {selecting && (
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-start gap-1.5">
            {row.pinned && (
              <Pin
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                aria-label="Pinned"
              />
            )}
            <span className="line-clamp-2 text-sm font-medium leading-snug">
              {row.title}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <SeverityPill severity={row.type === "bug" ? row.severity : null} />
            <StatusPill status={row.status} />
            {row.came_back_at && (
              <span
                className={cn(
                  PILL,
                  "gap-1 bg-red-500/15 text-red-700 dark:text-red-300",
                )}
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Came back
              </span>
            )}
            {row.needs_check && (
              <span
                className={cn(
                  PILL,
                  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                )}
              >
                Needs your check
              </span>
            )}
            <span>{SECTION_LABEL[row.section]}</span>
            <span aria-hidden>·</span>
            <span>{SOURCE_LABEL[row.source]}</span>
            {row.count > 1 && (
              <span className="font-medium tabular-nums text-foreground">
                ×{row.count}
              </span>
            )}
            <span aria-hidden>·</span>
            <time dateTime={row.last_seen}>{ago(row.last_seen)}</time>
          </span>
        </span>
      </button>
    </li>
  );
}
