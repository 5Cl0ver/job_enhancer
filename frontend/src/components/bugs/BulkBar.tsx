import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBulkBugs } from "@/hooks/useBugReports";
import {
  type BugSection,
  type BugStatus,
  type BugType,
  SECTIONS,
  SECTION_LABEL,
  STATUS_LABEL,
  statusesFor,
} from "@/lib/bugs";

const PICK =
  "h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-base md:text-sm pointer-coarse:h-11";

/** Several reports at once: change their status or section, or copy them. */
export function BulkBar({
  ids,
  type,
  onCopy,
  onDone,
  onApplied,
}: {
  ids: string[];
  type: BugType;
  onCopy: () => void;
  onDone: () => void;
  /** After a change: the selection is cleared (the rows may have moved). */
  onApplied: () => void;
}) {
  const bulk = useBulkBugs();
  const apply = (body: { status?: BugStatus; section?: BugSection }) =>
    bulk.mutate(
      { ids, ...body },
      {
        onSuccess: ({ changed }) => {
          toast.success(changed === 1 ? "1 changed" : `${changed} changed`);
          onApplied();
        },
      },
    );
  return (
    <div
      role="region"
      aria-label="Selected reports"
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-2 backdrop-blur md:sticky md:bottom-0 md:rounded-xl md:border md:shadow-lg"
    >
      {/* On a phone: the count and close on top, the three actions below. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <p className="text-sm font-medium tabular-nums">
          {ids.length} selected
        </p>
        <Button
          size="icon"
          variant="ghost"
          className="-mr-2"
          aria-label="Stop selecting"
          onClick={onDone}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 md:flex md:items-center">
        <p className="text-sm font-medium tabular-nums max-md:hidden">
          {ids.length} selected
        </p>
        <select
          aria-label="Set status"
          value=""
          disabled={!ids.length || bulk.isPending}
          onChange={(e) =>
            e.target.value && apply({ status: e.target.value as BugStatus })
          }
          className={PICK}
        >
          <option value="">Status…</option>
          {statusesFor(type).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Move to section"
          value=""
          disabled={!ids.length || bulk.isPending}
          onChange={(e) =>
            e.target.value && apply({ section: e.target.value as BugSection })
          }
          className={PICK}
        >
          <option value="">Section…</option>
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABEL[s]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!ids.length}
          onClick={onCopy}
          aria-label={`Copy ${ids.length} for Claude`}
        >
          <Copy aria-hidden /> Copy
          <span className="max-md:hidden"> {ids.length} for Claude</span>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto max-md:hidden"
          aria-label="Stop selecting"
          onClick={onDone}
        >
          <X aria-hidden />
        </Button>
      </div>
      {bulk.isError && (
        <p className="mt-1 text-xs text-destructive">
          Couldn't change them. Try again.
        </p>
      )}
    </div>
  );
}
