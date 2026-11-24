import { InfoBubble } from "@/components/common/InfoBubble";
import { useUsage, type AllowanceKind } from "@/hooks/useUsage";
import { cn } from "@/lib/utils";

const WHAT: Record<AllowanceKind, string> = {
  ai_document: "free AI documents",
  ai_read: "free résumé reads",
  ai_autofill: "free AI autofill helps",
  live_search: "live searches",
};

/**
 * "4 of 5 live searches left today ⓘ" (spec 019 part C). Shows nothing for
 * the owner (never limited) or for a kind that isn't in use right now.
 */
export function AllowanceNote({ kind, className }: { kind: AllowanceKind; className?: string }) {
  const { data } = useUsage();
  const k = data?.kinds[kind];
  if (!data || data.exempt || !k?.on) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs",
        k.left === 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
        className,
      )}
      data-testid={`allowance-${kind}`}
    >
      {k.left} of {k.limit} {WHAT[kind]} left today
      <InfoBubble topic="allowance" />
    </span>
  );
}
