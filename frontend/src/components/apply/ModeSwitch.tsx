import { useSetMode } from "@/hooks/useApply";
import { cn } from "@/lib/utils";
import { type ApplyMode, type ApplyRun, MODE_LABEL } from "@/lib/apply";

const WHAT: Record<ApplyMode, string> = {
  page: "Claude stops after each step so you can look it over.",
  keep: "Claude fills every step, marks its guesses, and you check it all at the end.",
};

/**
 * Page by page (the default) or Keep going (spec 033), any time. On the
 * Start step it says what each means; in the list's header it's compact.
 */
export function ModeSwitch({ run, explain = false }: { run: ApplyRun; explain?: boolean }) {
  const set = useSetMode();
  const mode: ApplyMode = run.mode ?? "page";
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label="How Claude goes"
        className={cn("inline-grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5", explain ? "w-full text-sm" : "text-xs")}
      >
        {(["page", "keep"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={set.isPending}
            onClick={() => mode !== m && set.mutate({ runId: run.id, mode: m })}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 transition-colors",
              explain ? "min-h-10" : "min-h-8",
              mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {explain && <p className="text-xs text-muted-foreground">{WHAT[mode]} You can switch any time.</p>}
      {set.isError && <p className="text-xs text-destructive">Couldn't switch. Try again.</p>}
    </div>
  );
}
