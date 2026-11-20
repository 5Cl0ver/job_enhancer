import { Lightbulb } from "lucide-react";

import { cn } from "@/lib/utils";

/** What to change when a finished search came back short (the app's own tip). */
export function RunTip({ tip, className }: { tip: string; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-sm", className)}>
      <Lightbulb
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
        aria-hidden
      />
      <span>
        <span className="font-medium">Tip: </span>
        {tip}
      </span>
    </p>
  );
}
