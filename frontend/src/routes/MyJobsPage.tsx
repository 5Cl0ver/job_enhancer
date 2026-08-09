import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LayoutList, Columns3 } from "lucide-react";
import { AddJobDialog } from "@/components/jobs/AddJobDialog";
import { SavedJobsBody } from "@/components/jobs/SavedJobsBody";
import { KanbanBoard } from "@/components/tracker/KanbanBoard";
import { cn } from "@/lib/utils";

type View = "list" | "board";

/**
 * My Jobs — the merged Saved + Tracker page. Same jobs, two views:
 *   • List  — your saved library (collections + cards, applied badges)
 *   • Board — the kanban pipeline (drag between stages)
 * One nav item, one place. `?view=board` deep-links the board.
 */
export default function MyJobsPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "board" ? "board" : "list");

  const choose = (v: View) => {
    setView(v);
    setParams(v === "board" ? { view: "board" } : {}, { replace: true });
  };

  return (
    <div className="container mx-auto max-w-full px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">My Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Everything you've saved and where each one stands.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex overflow-hidden rounded-lg border">
            <button
              onClick={() => choose("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium",
                view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <LayoutList className="h-4 w-4" /> List
            </button>
            <button
              onClick={() => choose("board")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium",
                view === "board"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <Columns3 className="h-4 w-4" /> Board
            </button>
          </div>
          {view === "list" && <AddJobDialog />}
        </div>
      </div>

      {view === "board" ? <KanbanBoard /> : <SavedJobsBody />}
    </div>
  );
}
