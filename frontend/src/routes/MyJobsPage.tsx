import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LayoutList, Columns3 } from "lucide-react";
import { AddJobDialog } from "@/components/jobs/AddJobDialog";
import { PhoneJobList } from "@/components/jobs/PhoneJobList";
import { SavedJobsBody } from "@/components/jobs/SavedJobsBody";
import { TopBarActions } from "@/components/layout/PhoneNav";
import { KanbanBoard } from "@/components/tracker/KanbanBoard";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";

type View = "list" | "board";

const VIEWS = [
  { id: "list", label: "List", icon: LayoutList },
  { id: "board", label: "Board", icon: Columns3 },
] as const;

/** List / Board switch. `compact` is the phone's top-bar form: icons only. */
function ViewToggle({
  view,
  onChoose,
  compact = false,
}: {
  view: View;
  onChoose: (v: View) => void;
  compact?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border">
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          aria-label={compact ? `${label} view` : undefined}
          onClick={() => onChoose(id)}
          className={cn(
            "flex items-center justify-center gap-1.5 text-sm font-medium",
            compact ? "h-9 w-11" : "px-3 py-1.5",
            view === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}

/**
 * My Jobs — the merged Saved + Tracker page. Same jobs, two views:
 *   • List  — your saved library (a computer: folders + cards; a phone: rows)
 *   • Board — the kanban pipeline (drag between stages)
 * One nav item, one place. `?view=board` deep-links the board.
 */
export default function MyJobsPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "board" ? "board" : "list");
  const phone = useIsPhone();

  const choose = (v: View) => {
    setView(v);
    setParams(v === "board" ? { view: "board" } : {}, { replace: true });
  };

  return (
    <div
      className={cn(
        "mx-auto max-w-full",
        // The board fills the window and its columns scroll, so the page itself
        // doesn't. The heights are the window minus the layout's padding; on a
        // phone, minus the top bar (and its 1px border) too, down to just above
        // the tab bar.
        view === "board"
          ? "-mb-8 flex h-[calc(100dvh-7.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col md:mb-0 md:h-[calc(100dvh-4rem)]"
          : "container md:px-4 md:py-6",
      )}
    >
      {phone ? (
        // On a phone the title is in the top bar; the buttons join it there.
        <TopBarActions>
          <ViewToggle view={view} onChoose={choose} compact />
          <AddJobDialog compact />
        </TopBarActions>
      ) : (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3",
            view === "board" ? "mb-3" : "mb-6",
          )}
        >
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">My Jobs</h1>
            {view === "list" && (
              <p className="text-sm text-muted-foreground">
                Everything you&apos;ve saved and where each one stands.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <ViewToggle view={view} onChoose={choose} />
            {view === "list" && <AddJobDialog />}
          </div>
        </div>
      )}

      {view === "board" ? <KanbanBoard /> : phone ? <PhoneJobList /> : <SavedJobsBody />}
    </div>
  );
}
