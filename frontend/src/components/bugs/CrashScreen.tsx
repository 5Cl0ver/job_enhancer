import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportCaught } from "@/lib/catchErrors";

/**
 * What anyone sees when a page breaks (spec 032): a friendly line, Reload and
 * Go home, instead of a blank page. The crash itself goes to Bugs & ideas
 * (only when signed in, never who; `lib/catchErrors`).
 */
export function CrashScreen() {
  const error = useRouteError();
  useEffect(() => {
    // A "not found" from the router isn't a crash.
    if (!isRouteErrorResponse(error))
      void reportCaught(error, { kind: "crash" });
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-5 text-center">
        <TriangleAlert
          className="mx-auto h-10 w-10 text-amber-500"
          aria-hidden
        />
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            This page broke. Reloading usually fixes it. Nothing you saved is
            lost.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            className="w-full sm:w-auto"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
          {/* A full page load: the app starts fresh. */}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
