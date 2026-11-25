import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProblemLine } from "@/components/apply/Problems";
import { useApplyProblems } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";

const FIRST = 10;

/**
 * Problems Claude ran into during applications (spec 030), everyone's,
 * newest first, so the developer can fix them. Admin only.
 */
export function ApplyProblemsCard() {
  const { data = [], isLoading, isError, refetch, isFetching } = useApplyProblems();
  const [all, setAll] = useState(false);
  const shown = all ? data : data.slice(0, FIRST);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Apply problems</CardTitle>
          <CardDescription>What Claude ran into while applying, last 60 days.</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 gap-1 text-xs"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load the problems.</p>
        ) : !data.length ? (
          <p className="text-sm text-muted-foreground">No problems reported.</p>
        ) : (
          <ul className="divide-y text-sm">
            {shown.map((p) => (
              <li key={`${p.run_id}-${p.id}`} className="space-y-0.5 py-2">
                <ProblemLine problem={p} />
                <span className="block truncate text-xs text-muted-foreground">
                  {[p.job, p.user_email].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.length > FIRST && (
          <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${data.length}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
