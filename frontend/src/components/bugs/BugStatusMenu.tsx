import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateBug } from "@/hooks/useBugReports";
import {
  type BugRow,
  type BugStatus,
  STATUS_LABEL,
  statusesFor,
} from "@/lib/bugs";

/**
 * Move a report along: any status at any time. Fixed asks, optionally,
 * "Fixed in which version?" before it's saved.
 */
export function BugStatusMenu({
  report,
}: {
  report: Pick<BugRow, "id" | "type" | "status">;
}) {
  const update = useUpdateBug();
  const [fixing, setFixing] = useState(false);
  const [version, setVersion] = useState("");

  const pick = (status: BugStatus) => {
    if (status === "fixed" && report.type === "bug") {
      setFixing(true);
      return;
    }
    setFixing(false);
    update.mutate({ id: report.id, status });
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <select
          aria-label="Status"
          value={fixing ? "fixed" : report.status}
          disabled={update.isPending}
          onChange={(e) => pick(e.target.value as BugStatus)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm pointer-coarse:h-11 dark:bg-input/30"
        >
          {statusesFor(report.type).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {fixing && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              {
                id: report.id,
                status: "fixed",
                ...(version.trim() ? { fixed_in: version.trim() } : {}),
              },
              {
                onSuccess: () => {
                  setFixing(false);
                  setVersion("");
                },
              },
            );
          }}
        >
          <Input
            aria-label="Fixed in which version?"
            placeholder="Fixed in which version? (optional)"
            value={version}
            maxLength={60}
            onChange={(e) => setVersion(e.target.value)}
            className="min-w-0 flex-1"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={update.isPending}>
            {update.isPending && (
              <Loader2 className="animate-spin" aria-hidden />
            )}
            Mark fixed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFixing(false)}
          >
            Cancel
          </Button>
        </form>
      )}
      {update.isError && (
        <p className="text-xs text-destructive">
          Couldn't save that. Try again.
        </p>
      )}
    </div>
  );
}
