import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ApplyProblem, PROBLEM_KIND } from "@/lib/apply";

const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The page's address without "https://", short enough for a phone. */
export const pageLabel = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

/** One problem: what kind, what happened, where, how many times. */
export function ProblemLine({ problem }: { problem: ApplyProblem }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 font-medium">{PROBLEM_KIND[problem.kind] ?? "Other"}</span>
        <time dateTime={problem.at}>{time(problem.at)}</time>
        {problem.count > 1 && <span>{problem.count} times</span>}
      </span>
      <span className="block break-words">{problem.what}</span>
      {problem.page && <span className="block truncate text-xs text-muted-foreground">{pageLabel(problem.page)}</span>}
    </>
  );
}

/**
 * "Problems Claude ran into" (spec 030): what went wrong during this
 * application, as Claude noted it for the developer. Closed until tapped.
 */
export function Problems({ problems }: { problems?: ApplyProblem[] }) {
  const [open, setOpen] = useState(false);
  if (!problems?.length) return null;
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          Problems Claude ran into ({problems.length})
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Noted for the developer, to fix. Nothing you need to do.
          </p>
          <ul className="space-y-2 text-sm">
            {[...problems].reverse().map((p) => (
              <li key={p.id} className="space-y-0.5">
                <ProblemLine problem={p} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
