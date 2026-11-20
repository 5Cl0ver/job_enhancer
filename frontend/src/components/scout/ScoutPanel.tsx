/**
 * The Claude Scout tab on Find Jobs. Claude in Chrome does the browsing; this
 * app is its memory. Three views: Start (searches + the run in progress),
 * History (past runs) and Resume types (one per kind of role).
 */
import { useSearchParams } from "react-router-dom";
import { ResumeTypes } from "@/components/scout/ResumeTypes";
import { ScoutHistory } from "@/components/scout/ScoutHistory";
import { ScoutStart } from "@/components/scout/ScoutStart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VIEWS = ["start", "history", "types"] as const;
type View = (typeof VIEWS)[number];

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

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground max-md:hidden">
        Claude in Chrome searches the job boards for you and brings back what fits. You pick
        what to keep and where; nothing comes back twice.
      </p>
      <Tabs value={view} onValueChange={setView} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="start" className="flex-1 sm:flex-none">
            Start
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 sm:flex-none">
            History
          </TabsTrigger>
          <TabsTrigger value="types" className="flex-1 sm:flex-none">
            Resume types
          </TabsTrigger>
        </TabsList>
        <TabsContent value="start">
          <ScoutStart onSetUpTypes={() => setView("types")} />
        </TabsContent>
        <TabsContent value="history">
          <ScoutHistory />
        </TabsContent>
        <TabsContent value="types">
          <ResumeTypes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
