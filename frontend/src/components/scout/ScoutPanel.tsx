/**
 * The Claude Scout tab on Find Jobs. Claude in Chrome does the browsing; this
 * app is its memory. Five views: Start (searches, the run in progress and the
 * last run), Results (every job found, best first), History (past runs, each
 * with its log), Resume types (one per kind of role) and Instructions
 * (everything Claude is told, editable). Phones get short tab names so all
 * five fit.
 */
import { useSearchParams } from "react-router-dom";
import { ResumeTypes } from "@/components/scout/ResumeTypes";
import { ScoutHistory } from "@/components/scout/ScoutHistory";
import { ScoutInstructions } from "@/components/scout/ScoutInstructions";
import { ScoutResults } from "@/components/scout/ScoutResults";
import { ScoutStart } from "@/components/scout/ScoutStart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VIEWS = ["start", "results", "history", "types", "instructions"] as const;
type View = (typeof VIEWS)[number];

const LABELS: Record<View, [short: string, full: string]> = {
  start: ["Start", "Start"],
  results: ["Results", "Results"],
  history: ["History", "History"],
  types: ["Types", "Resume types"],
  instructions: ["Rules", "Instructions"],
};

export function ScoutPanel() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : "start";
  const setView = (v: string) =>
    setParams(
      (p) => {
        p.set("view", v);
        return p;
      },
      { replace: true },
    );
  // Results on one run ("See results"), or on every run's new jobs.
  const openResults = (runId: string | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("view", "results");
      next.set("run", runId ?? "all");
      next.set("status", "new");
      next.delete("type");
      return next;
    });

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground max-md:hidden">
        Claude in Chrome searches the job boards for you and brings back what
        fits. You pick what to keep and where; nothing comes back twice.
      </p>
      <Tabs value={view} onValueChange={setView} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          {VIEWS.map((v) => (
            <TabsTrigger
              key={v}
              value={v}
              className="flex-1 px-1.5 sm:flex-none sm:px-3"
            >
              <span className="sm:hidden">{LABELS[v][0]}</span>
              <span className="max-sm:hidden">{LABELS[v][1]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="start">
          <ScoutStart
            onSetUpTypes={() => setView("types")}
            onOpenResults={openResults}
          />
        </TabsContent>
        <TabsContent value="results">
          <ScoutResults />
        </TabsContent>
        <TabsContent value="history">
          <ScoutHistory />
        </TabsContent>
        <TabsContent value="types">
          <ResumeTypes />
        </TabsContent>
        <TabsContent value="instructions">
          <ScoutInstructions />
        </TabsContent>
      </Tabs>
    </div>
  );
}
